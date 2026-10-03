// Personas y dueños de tarjeta.
import { db, ejecutar, enTransaccion, todas, una } from "./conexion";

export interface Persona {
  id: number;
  nombre: string;
  es_yo: number;
}

export interface FilaTarjeta {
  tipo_tarjeta: string;
  ultimos_4: string;
  titular: string;
  persona_id: number | null;
  cantidad_gastos: number;
}

export async function listarPersonas(): Promise<(Persona & { cantidad_asignaciones: number })[]> {
  return todas(
    await db(),
    `SELECT p.*, (SELECT COUNT(*) FROM asignaciones a WHERE a.persona_id = p.id) AS cantidad_asignaciones
     FROM personas p ORDER BY p.es_yo DESC, p.nombre`,
  );
}

export async function crearPersona(nombre: string): Promise<number> {
  return (await ejecutar(await db(), "INSERT INTO personas (nombre) VALUES (?)", [nombre])).id;
}

export async function renombrarPersona(id: number, nombre: string): Promise<void> {
  await ejecutar(await db(), "UPDATE personas SET nombre = ? WHERE id = ?", [nombre, id]);
}

/**
 * Solo se puede borrar una persona sin gastos, impuestos ni pagos (para no perder nada).
 * Lo revisamos acá mismo en vez de confiar solo en las foreign keys de la base.
 */
export async function eliminarPersona(id: number): Promise<void> {
  await enTransaccion(async (tx) => {
    const uso = await una<{ n: number }>(
      tx,
      `SELECT (SELECT COUNT(*) FROM asignaciones WHERE persona_id = ?)
            + (SELECT COUNT(*) FROM impuestos_manual WHERE persona_id = ?)
            + (SELECT COUNT(*) FROM pagos WHERE persona_id = ?) AS n`,
      [id, id, id],
    );
    if (uso!.n > 0) throw new Error("FOREIGN KEY: la persona tiene datos cargados");
    await ejecutar(tx, "UPDATE tarjetas SET persona_id = NULL WHERE persona_id = ?", [id]);
    await ejecutar(tx, "DELETE FROM personas WHERE id = ?", [id]);
  });
}

export async function listarTarjetas(): Promise<FilaTarjeta[]> {
  return todas(
    await db(),
    `SELECT t.*, (SELECT COUNT(*) FROM gastos g
                  JOIN resumenes r ON r.id = g.resumen_id
                  WHERE r.tipo_tarjeta = t.tipo_tarjeta AND g.ultimos_4 = t.ultimos_4) AS cantidad_gastos
     FROM tarjetas t ORDER BY t.tipo_tarjeta, t.titular, t.ultimos_4`,
  );
}

/**
 * Cambia el dueño de una tarjeta. Además asigna a esa persona los gastos de la tarjeta
 * que estaban SIN ASIGNAR (los que ya tienen dueño no se tocan).
 * Devuelve cuántos gastos se asignaron.
 */
export async function asignarDuenioTarjeta(
  tipo: string,
  ultimos4: string,
  personaId: number | null,
): Promise<number> {
  return enTransaccion(async (tx) => {
    await ejecutar(tx, "UPDATE tarjetas SET persona_id = ? WHERE tipo_tarjeta = ? AND ultimos_4 = ?", [
      personaId,
      tipo,
      ultimos4,
    ]);
    if (personaId === null) return 0;
    const { cambios } = await ejecutar(
      tx,
      `INSERT INTO asignaciones (gasto_id, persona_id, centavos)
       SELECT g.id, ?, CAST(ROUND(g.monto * 100) AS INTEGER)
       FROM gastos g JOIN resumenes r ON r.id = g.resumen_id
       WHERE r.tipo_tarjeta = ? AND g.ultimos_4 = ?
         AND NOT EXISTS (SELECT 1 FROM asignaciones a WHERE a.gasto_id = g.id)`,
      [personaId, tipo, ultimos4],
    );
    return cambios;
  });
}
