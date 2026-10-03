// Pagos que te hace cada persona.
import type { Moneda } from "../parser/montos";
import type { Pago } from "../saldos";
import { db, ejecutar, todas } from "./conexion";

export interface NuevoPago {
  personaId: number;
  fecha: string; // ISO
  moneda: Moneda; // la deuda que cancela
  centavos: number;
  pagadoEnPesos: number | null;
  tipoCambio: number | null;
  nota: string | null;
}

export async function registrarPago(p: NuevoPago): Promise<number> {
  const existe = await todas(await db(), "SELECT 1 FROM personas WHERE id = ?", [p.personaId]);
  if (existe.length === 0) throw new Error("La persona no existe.");
  const { id } = await ejecutar(
    await db(),
    `INSERT INTO pagos (persona_id, fecha, moneda, centavos, pagado_en_pesos_centavos, tipo_cambio, nota)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.personaId, p.fecha, p.moneda, p.centavos, p.pagadoEnPesos, p.tipoCambio, p.nota],
  );
  return id;
}

export async function borrarPago(id: number): Promise<void> {
  await ejecutar(await db(), "DELETE FROM pagos WHERE id = ?", [id]);
}

/** Pagos de una persona (o de todas, con null), ordenados por fecha. */
export async function pagosDePersona(
  personaId: number | null,
): Promise<(Omit<Pago, "tipo"> & { personaId: number })[]> {
  const filas = await todas<{
    id: number;
    persona_id: number;
    fecha: string;
    moneda: Moneda;
    centavos: number;
    pagado_en_pesos_centavos: number | null;
    tipo_cambio: number | null;
    nota: string | null;
  }>(
    await db(),
    `SELECT id, persona_id, fecha, moneda, centavos, pagado_en_pesos_centavos, tipo_cambio, nota
     FROM pagos ${personaId === null ? "" : "WHERE persona_id = ?"} ORDER BY fecha, id`,
    personaId === null ? [] : [personaId],
  );
  return filas.map((f) => ({
    id: f.id,
    personaId: f.persona_id,
    fecha: f.fecha,
    moneda: f.moneda,
    centavos: f.centavos,
    pagadoEnPesos: f.pagado_en_pesos_centavos,
    tipoCambio: f.tipo_cambio,
    nota: f.nota,
  }));
}
