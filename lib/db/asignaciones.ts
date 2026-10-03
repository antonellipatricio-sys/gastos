// Quién paga cada gasto.
import { escalarReparto, validarReparto, type Parte } from "../reparto";
import { aCentavos, db, ejecutar, enTransaccion, todas, una, type Ejecutor } from "./conexion";

export interface GastoParaAsignar {
  id: number;
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
async function repartoDeCuotaAnterior(ej: Ejecutor, g: GastoParaAsignar): Promise<Parte[] | null> {
  if (g.cuotaActual === null || g.cuotasTotales === null || g.cuotaActual <= 1) return null;
  const anterior = await una<{ id: number }>(
    ej,
    `SELECT g.id FROM gastos g JOIN resumenes r ON r.id = g.resumen_id
     WHERE r.tipo_tarjeta = ? AND g.ultimos_4 = ? AND g.descripcion = ?
       AND g.cuotas_totales = ? AND g.cuota_actual = ? AND g.moneda = ? AND r.cierre < ?
     ORDER BY (g.comprobante IS ?) DESC, r.cierre DESC
     LIMIT 1`,
    [g.tipoTarjeta, g.ultimos4, g.descripcion, g.cuotasTotales, g.cuotaActual - 1, g.moneda, g.cierre, g.comprobante],
  );
  if (!anterior) return null;
  const partes = await todas<Parte>(
    ej,
    "SELECT persona_id AS personaId, centavos FROM asignaciones WHERE gasto_id = ? ORDER BY rowid",
    [anterior.id],
  );
  return partes.length ? partes : null;
}

/**
 * Reparto automático al importar:
 *   1. si es una cuota, hereda el reparto de la cuota anterior;
 *   2. si no, va entero al dueño de la tarjeta;
 *   3. si la tarjeta no tiene dueño, queda sin asignar.
 */
export async function repartoAutomatico(
  ej: Ejecutor,
  g: GastoParaAsignar,
  duenioTarjeta: number | null,
): Promise<Parte[]> {
  const heredado = await repartoDeCuotaAnterior(ej, g);
  if (heredado) return escalarReparto(heredado, g.centavos);
  if (duenioTarjeta !== null) return [{ personaId: duenioTarjeta, centavos: g.centavos }];
  return [];
}

export async function guardarPartes(ej: Ejecutor, gastoId: number, partes: Parte[]) {
  await ejecutar(ej, "DELETE FROM asignaciones WHERE gasto_id = ?", [gastoId]);
  for (const p of partes) {
    await ejecutar(ej, "INSERT INTO asignaciones (gasto_id, persona_id, centavos) VALUES (?, ?, ?)", [
      gastoId,
      p.personaId,
      p.centavos,
    ]);
  }
}

/** Cambia el reparto de un gasto. Lista vacía = dejarlo sin asignar. */
export async function asignarGasto(gastoId: number, partes: Parte[]): Promise<void> {
  const gasto = await una<{ monto: number }>(await db(), "SELECT monto FROM gastos WHERE id = ?", [gastoId]);
  if (!gasto) throw new Error("El gasto no existe.");
  const error = validarReparto(partes, aCentavos(gasto.monto));
  if (error) throw new Error(error);
  await enTransaccion((tx) => guardarPartes(tx, gastoId, partes));
}

/** Todas las partes de los gastos de un resumen, agrupadas por gasto. */
export async function partesDeResumen(resumenId: number): Promise<Map<number, Parte[]>> {
  const filas = await todas<{ gasto_id: number; personaId: number; centavos: number }>(
    await db(),
    `SELECT a.gasto_id, a.persona_id AS personaId, a.centavos
     FROM asignaciones a JOIN gastos g ON g.id = a.gasto_id
     WHERE g.resumen_id = ? ORDER BY a.rowid`,
    [resumenId],
  );
  const porGasto = new Map<number, Parte[]>();
  for (const f of filas) {
    const lista = porGasto.get(f.gasto_id) ?? [];
    lista.push({ personaId: f.personaId, centavos: f.centavos });
    porGasto.set(f.gasto_id, lista);
  }
  return porGasto;
}
