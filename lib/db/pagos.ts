// Pagos que te hace cada persona.
import type { Moneda } from "../parser/montos";
import type { Pago } from "../saldos";
import { colecciones, siguientesIds } from "./conexion";

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
  const col = await colecciones();
  if (!(await col.personas.findOne({ _id: p.personaId }))) throw new Error("La persona no existe.");
  const id = await siguientesIds(col, "pagos");
  await col.pagos.insertOne({ _id: id, ...p, creadoEn: new Date() });
  return id;
}

export async function borrarPago(id: number): Promise<void> {
  await (await colecciones()).pagos.deleteOne({ _id: id });
}

/** Pagos de una persona (o de todas, con null), ordenados por fecha. */
export async function pagosDePersona(
  personaId: number | null,
): Promise<(Omit<Pago, "tipo"> & { personaId: number })[]> {
  const col = await colecciones();
  const pagos = await col.pagos
    .find(personaId === null ? {} : { personaId })
    .sort({ fecha: 1, _id: 1 })
    .toArray();
  return pagos.map((p) => ({
    id: p._id,
    personaId: p.personaId,
    fecha: p.fecha,
    moneda: p.moneda,
    centavos: p.centavos,
    pagadoEnPesos: p.pagadoEnPesos,
    tipoCambio: p.tipoCambio,
    nota: p.nota,
  }));
}
