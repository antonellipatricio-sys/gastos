// Personas y dueños de tarjeta.
import { db } from "./conexion";

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
  return db()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM asignaciones a WHERE a.persona_id = p.id) AS cantidad_asignaciones
       FROM personas p ORDER BY p.es_yo DESC, p.nombre`,
    )
    .all() as (Persona & { cantidad_asignaciones: number })[];
}

export async function crearPersona(nombre: string): Promise<number> {
  const { lastInsertRowid } = db().prepare("INSERT INTO personas (nombre) VALUES (?)").run(nombre);
  return Number(lastInsertRowid);
}

export async function renombrarPersona(id: number, nombre: string): Promise<void> {
  db().prepare("UPDATE personas SET nombre = ? WHERE id = ?").run(nombre, id);
}

/** Solo se puede borrar una persona sin gastos asignados (para no perder repartos). */
export async function eliminarPersona(id: number): Promise<void> {
  db().prepare("DELETE FROM personas WHERE id = ?").run(id);
}

export async function listarTarjetas(): Promise<FilaTarjeta[]> {
  return db()
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM gastos g
                    JOIN resumenes r ON r.id = g.resumen_id
                    WHERE r.tipo_tarjeta = t.tipo_tarjeta AND g.ultimos_4 = t.ultimos_4) AS cantidad_gastos
       FROM tarjetas t ORDER BY t.tipo_tarjeta, t.titular, t.ultimos_4`,
    )
    .all() as FilaTarjeta[];
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
  const conexion = db();
  return conexion.transaction(() => {
    conexion
      .prepare("UPDATE tarjetas SET persona_id = ? WHERE tipo_tarjeta = ? AND ultimos_4 = ?")
      .run(personaId, tipo, ultimos4);
    if (personaId === null) return 0;
    const { changes } = conexion
      .prepare(
        `INSERT INTO asignaciones (gasto_id, persona_id, centavos)
         SELECT g.id, ?, CAST(ROUND(g.monto * 100) AS INTEGER)
         FROM gastos g JOIN resumenes r ON r.id = g.resumen_id
         WHERE r.tipo_tarjeta = ? AND g.ultimos_4 = ?
           AND NOT EXISTS (SELECT 1 FROM asignaciones a WHERE a.gasto_id = g.id)`,
      )
      .run(personaId, tipo, ultimos4);
    return changes;
  })();
}
