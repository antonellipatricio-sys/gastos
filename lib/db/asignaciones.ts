// Quién paga cada gasto.
import type Database from "better-sqlite3";
import { escalarReparto, validarReparto, type Parte } from "../reparto";
import { aCentavos, db } from "./conexion";

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
function repartoDeCuotaAnterior(conexion: Database.Database, g: GastoParaAsignar): Parte[] | null {
  if (g.cuotaActual === null || g.cuotasTotales === null || g.cuotaActual <= 1) return null;
  const anterior = conexion
    .prepare(
      `SELECT g.id FROM gastos g JOIN resumenes r ON r.id = g.resumen_id
       WHERE r.tipo_tarjeta = ? AND g.ultimos_4 = ? AND g.descripcion = ?
         AND g.cuotas_totales = ? AND g.cuota_actual = ? AND g.moneda = ? AND r.cierre < ?
       ORDER BY (g.comprobante IS ?) DESC, r.cierre DESC
       LIMIT 1`,
    )
    .get(
      g.tipoTarjeta, g.ultimos4, g.descripcion, g.cuotasTotales, g.cuotaActual - 1, g.moneda,
      g.cierre, g.comprobante,
    ) as { id: number } | undefined;
  if (!anterior) return null;
  const partes = conexion
    .prepare("SELECT persona_id AS personaId, centavos FROM asignaciones WHERE gasto_id = ? ORDER BY rowid")
    .all(anterior.id) as Parte[];
  return partes.length ? partes : null;
}

/**
 * Reparto automático al importar:
 *   1. si es una cuota, hereda el reparto de la cuota anterior;
 *   2. si no, va entero al dueño de la tarjeta;
 *   3. si la tarjeta no tiene dueño, queda sin asignar.
 */
export function repartoAutomatico(
  conexion: Database.Database,
  g: GastoParaAsignar,
  duenioTarjeta: number | null,
): Parte[] {
  const heredado = repartoDeCuotaAnterior(conexion, g);
  if (heredado) return escalarReparto(heredado, g.centavos);
  if (duenioTarjeta !== null) return [{ personaId: duenioTarjeta, centavos: g.centavos }];
  return [];
}

export function guardarPartes(conexion: Database.Database, gastoId: number, partes: Parte[]) {
  conexion.prepare("DELETE FROM asignaciones WHERE gasto_id = ?").run(gastoId);
  const insertar = conexion.prepare("INSERT INTO asignaciones (gasto_id, persona_id, centavos) VALUES (?, ?, ?)");
  for (const p of partes) insertar.run(gastoId, p.personaId, p.centavos);
}

/** Cambia el reparto de un gasto. Lista vacía = dejarlo sin asignar. */
export async function asignarGasto(gastoId: number, partes: Parte[]): Promise<void> {
  const conexion = db();
  const gasto = conexion.prepare("SELECT monto FROM gastos WHERE id = ?").get(gastoId) as
    | { monto: number }
    | undefined;
  if (!gasto) throw new Error("El gasto no existe.");
  const error = validarReparto(partes, aCentavos(gasto.monto));
  if (error) throw new Error(error);
  conexion.transaction(() => guardarPartes(conexion, gastoId, partes))();
}

/** Todas las partes de los gastos de un resumen, agrupadas por gasto. */
export function partesDeResumen(resumenId: number): Map<number, Parte[]> {
  const filas = db()
    .prepare(
      `SELECT a.gasto_id, a.persona_id AS personaId, a.centavos
       FROM asignaciones a JOIN gastos g ON g.id = a.gasto_id
       WHERE g.resumen_id = ? ORDER BY a.rowid`,
    )
    .all(resumenId) as { gasto_id: number; personaId: number; centavos: number }[];
  const porGasto = new Map<number, Parte[]>();
  for (const f of filas) {
    const lista = porGasto.get(f.gasto_id) ?? [];
    lista.push({ personaId: f.personaId, centavos: f.centavos });
    porGasto.set(f.gasto_id, lista);
  }
  return porGasto;
}
