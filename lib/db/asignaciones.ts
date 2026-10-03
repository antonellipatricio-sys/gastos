// Quién paga cada gasto (el campo `partes` de cada gasto).
import type { ClientSession } from "mongodb";
import { escalarReparto, validarReparto, type Parte } from "../reparto";
import { colecciones, type Colecciones } from "./conexion";

export interface GastoParaAsignar {
  tipoTarjeta: string;
  cierre: string;
  ultimos4: string;
  descripcion: string;
  cuotaActual: number | null;
  cuotasTotales: number | null;
  comprobante: string | null;
  moneda: string;
  centavos: number;
}

/**
 * Busca la cuota anterior del mismo gasto en un resumen anterior ya importado
 * (misma tarjeta, misma descripción, mismo total de cuotas y número de cuota - 1).
 * Si la encuentra y estaba asignada, devuelve su reparto.
 */
async function repartoDeCuotaAnterior(
  col: Colecciones,
  g: GastoParaAsignar,
  session?: ClientSession,
): Promise<Parte[] | null> {
  if (g.cuotaActual === null || g.cuotasTotales === null || g.cuotaActual <= 1) return null;
  const candidatas = await col.gastos
    .find(
      {
        tipo: g.tipoTarjeta,
        ultimos4: g.ultimos4,
        descripcion: g.descripcion,
        cuotasTotales: g.cuotasTotales,
        cuotaActual: g.cuotaActual - 1,
        moneda: g.moneda as "ARS" | "USD",
        cierre: { $lt: g.cierre },
      },
      { session, sort: { cierre: -1 } },
    )
    .toArray();
  // Preferimos la que tiene el mismo comprobante; si no, la más reciente.
  const anterior = candidatas.find((c) => c.comprobante === g.comprobante) ?? candidatas[0];
  return anterior && anterior.partes.length ? anterior.partes : null;
}

/**
 * Reparto automático al importar:
 *   1. si es una cuota, hereda el reparto de la cuota anterior;
 *   2. si no, va entero al dueño de la tarjeta;
 *   3. si la tarjeta no tiene dueño, queda sin asignar.
 */
export async function repartoAutomatico(
  col: Colecciones,
  g: GastoParaAsignar,
  duenioTarjeta: number | null,
  session?: ClientSession,
): Promise<Parte[]> {
  const heredado = await repartoDeCuotaAnterior(col, g, session);
  if (heredado) return escalarReparto(heredado, g.centavos);
  if (duenioTarjeta !== null) return [{ personaId: duenioTarjeta, centavos: g.centavos }];
  return [];
}

/** Cambia el reparto de un gasto. Lista vacía = dejarlo sin asignar. */
export async function asignarGasto(gastoId: number, partes: Parte[]): Promise<void> {
  const col = await colecciones();
  const gasto = await col.gastos.findOne({ _id: gastoId }, { projection: { centavos: 1 } });
  if (!gasto) throw new Error("El gasto no existe.");
  const error = validarReparto(partes, gasto.centavos);
  if (error) throw new Error(error);
  const ids = partes.map((p) => p.personaId);
  if ((await col.personas.countDocuments({ _id: { $in: ids } })) !== ids.length) {
    throw new Error("Alguna de las personas no existe.");
  }
  // Un solo documento: el cambio es atómico (se guarda entero o no se guarda).
  await col.gastos.updateOne(
    { _id: gastoId },
    { $set: { partes: partes.map((p) => ({ personaId: p.personaId, centavos: p.centavos })) } },
  );
}
