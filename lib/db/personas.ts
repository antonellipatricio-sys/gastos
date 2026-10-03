// Personas y dueños de tarjeta.
import { colecciones, enTransaccion, esDuplicado, siguientesIds } from "./conexion";

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

/** Cuántos gastos tiene asignados (enteros o una parte) cada persona. */
async function asignacionesPorPersona(): Promise<Map<number, number>> {
  const col = await colecciones();
  const filas = await col.gastos
    .aggregate<{ _id: number; n: number }>([
      { $unwind: "$partes" },
      { $group: { _id: "$partes.personaId", n: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(filas.map((f) => [f._id, f.n]));
}

export async function listarPersonas(): Promise<(Persona & { cantidad_asignaciones: number })[]> {
  const col = await colecciones();
  const [personas, cantidades] = await Promise.all([
    col.personas.find().sort({ esYo: -1, nombre: 1 }).collation({ locale: "es" }).toArray(),
    asignacionesPorPersona(),
  ]);
  return personas.map((p) => ({
    id: p._id,
    nombre: p.nombre,
    es_yo: p.esYo ? 1 : 0,
    cantidad_asignaciones: cantidades.get(p._id) ?? 0,
  }));
}

export async function crearPersona(nombre: string): Promise<number> {
  const col = await colecciones();
  const id = await siguientesIds(col, "personas");
  try {
    await col.personas.insertOne({ _id: id, nombre, esYo: false });
  } catch (e) {
    if (esDuplicado(e)) throw new Error("UNIQUE: ya existe una persona con ese nombre");
    throw e;
  }
  return id;
}

export async function renombrarPersona(id: number, nombre: string): Promise<void> {
  const col = await colecciones();
  try {
    await col.personas.updateOne({ _id: id }, { $set: { nombre } });
  } catch (e) {
    if (esDuplicado(e)) throw new Error("UNIQUE: ya existe una persona con ese nombre");
    throw e;
  }
}

/** Solo se puede borrar una persona sin gastos, impuestos ni pagos (para no perder nada). */
export async function eliminarPersona(id: number): Promise<void> {
  await enTransaccion(async (session, col) => {
    const usos = await Promise.all([
      col.gastos.countDocuments({ "partes.personaId": id }, { session }),
      col.resumenes.countDocuments({ "impuestosManual.personaId": id }, { session }),
      col.pagos.countDocuments({ personaId: id }, { session }),
    ]);
    if (usos.some((n) => n > 0)) throw new Error("FOREIGN KEY: la persona tiene datos cargados");
    await col.tarjetas.updateMany({ personaId: id }, { $set: { personaId: null } }, { session });
    await col.personas.deleteOne({ _id: id }, { session });
  });
}

export async function listarTarjetas(): Promise<FilaTarjeta[]> {
  const col = await colecciones();
  const [tarjetas, cantidades] = await Promise.all([
    col.tarjetas.find().sort({ tipo: 1, titular: 1, ultimos4: 1 }).toArray(),
    col.gastos
      .aggregate<{ _id: { tipo: string; ultimos4: string }; n: number }>([
        { $group: { _id: { tipo: "$tipo", ultimos4: "$ultimos4" }, n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const cantidad = (tipo: string, u4: string) =>
    cantidades.find((c) => c._id.tipo === tipo && c._id.ultimos4 === u4)?.n ?? 0;
  return tarjetas.map((t) => ({
    tipo_tarjeta: t.tipo,
    ultimos_4: t.ultimos4,
    titular: t.titular,
    persona_id: t.personaId,
    cantidad_gastos: cantidad(t.tipo, t.ultimos4),
  }));
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
  return enTransaccion(async (session, col) => {
    if (personaId !== null && !(await col.personas.findOne({ _id: personaId }, { session }))) {
      throw new Error("La persona no existe.");
    }
    await col.tarjetas.updateOne({ tipo, ultimos4 }, { $set: { personaId } }, { session });
    if (personaId === null) return 0;
    // "Pipeline" de actualización: arma las partes usando el monto de cada gasto ($centavos).
    const r = await col.gastos.updateMany(
      { tipo, ultimos4, partes: { $size: 0 } },
      [{ $set: { partes: [{ personaId, centavos: "$centavos" }] } }],
      { session },
    );
    return r.modifiedCount;
  });
}
