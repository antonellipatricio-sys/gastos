// Pagos que te hace cada persona.
import type { Moneda } from "../parser/montos";
import type { Pago } from "../saldos";
import { db } from "./conexion";

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
  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO pagos (persona_id, fecha, moneda, centavos, pagado_en_pesos_centavos, tipo_cambio, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.personaId, p.fecha, p.moneda, p.centavos, p.pagadoEnPesos, p.tipoCambio, p.nota);
  return Number(lastInsertRowid);
}

export async function borrarPago(id: number): Promise<void> {
  db().prepare("DELETE FROM pagos WHERE id = ?").run(id);
}

export function pagosDePersona(personaId: number | null): (Omit<Pago, "tipo"> & { personaId: number })[] {
  const filas = db()
    .prepare(
      `SELECT id, persona_id, fecha, moneda, centavos, pagado_en_pesos_centavos, tipo_cambio, nota
       FROM pagos ${personaId === null ? "" : "WHERE persona_id = ?"} ORDER BY fecha, id`,
    )
    .all(...(personaId === null ? [] : [personaId])) as {
    id: number;
    persona_id: number;
    fecha: string;
    moneda: Moneda;
    centavos: number;
    pagado_en_pesos_centavos: number | null;
    tipo_cambio: number | null;
    nota: string | null;
  }[];
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
