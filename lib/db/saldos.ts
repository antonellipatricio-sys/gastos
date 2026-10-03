// Saldos: cuánto le toca a cada persona de cada resumen (consumos + impuestos) y cuánto pagó.
import type { Moneda } from "../parser/montos";
import {
  calcularMovimientos,
  cero,
  cuotasPendientes,
  repartirImpuestos,
  saldoFinal,
  sumarTotales,
  type Cargo,
  type CriterioImpuestos,
  type CuotaDeLaPersona,
  type GastoDelDetalle,
  type ImpuestoManual,
  type LineaImpuesto,
  type Totales,
} from "../saldos";
import { aCentavos, db } from "./conexion";
import { pagosDePersona } from "./pagos";
import { listarPersonas } from "./personas";

const NOMBRE_TARJETA: Record<string, string> = { VISA: "Visa", AMEX: "American Express" };

function fechaCorta(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

function idDeVos(): number {
  const fila = db().prepare("SELECT id FROM personas ORDER BY es_yo DESC, id LIMIT 1").get() as { id: number } | undefined;
  if (!fila) throw new Error("No hay personas cargadas.");
  return fila.id;
}

interface FilaResumenImpuestos {
  id: number;
  tipo_tarjeta: string;
  cierre: string;
  total_impuestos_pesos: number;
  total_impuestos_dolares: number;
  criterio_impuestos: CriterioImpuestos;
}

/** Consumo asignado a cada persona en un resumen (sin impuestos). */
function consumoDeResumen(resumenId: number): Map<number, Totales> {
  const filas = db()
    .prepare(
      `SELECT a.persona_id, g.moneda, SUM(a.centavos) AS centavos
       FROM asignaciones a JOIN gastos g ON g.id = a.gasto_id
       WHERE g.resumen_id = ? GROUP BY a.persona_id, g.moneda`,
    )
    .all(resumenId) as { persona_id: number; moneda: Moneda; centavos: number }[];
  const mapa = new Map<number, Totales>();
  for (const f of filas) {
    const t = mapa.get(f.persona_id) ?? cero();
    t[f.moneda] += f.centavos;
    mapa.set(f.persona_id, t);
  }
  return mapa;
}

function calcularImpuestos(r: FilaResumenImpuestos, consumo: Map<number, Totales>) {
  let lineas = db()
    .prepare("SELECT descripcion, moneda, centavos FROM impuestos_lineas WHERE resumen_id = ? ORDER BY rowid")
    .all(r.id) as LineaImpuesto[];
  // Resúmenes importados antes de la Fase 3: solo tenemos el total, sin el detalle por línea.
  const sinDetalle = lineas.length === 0 && (r.total_impuestos_pesos !== 0 || r.total_impuestos_dolares !== 0);
  if (sinDetalle) {
    lineas = [
      { descripcion: "Impuestos (total)", moneda: "ARS" as const, centavos: aCentavos(r.total_impuestos_pesos) },
      { descripcion: "Impuestos (total)", moneda: "USD" as const, centavos: aCentavos(r.total_impuestos_dolares) },
    ].filter((l) => l.centavos !== 0);
  }
  const manual = db()
    .prepare("SELECT persona_id AS personaId, moneda, centavos FROM impuestos_manual WHERE resumen_id = ?")
    .all(r.id) as ImpuestoManual[];
  const porPersona = repartirImpuestos({ lineas, consumo, criterio: r.criterio_impuestos, manual, yoId: idDeVos() });
  return { criterio: r.criterio_impuestos, lineas, sinDetalle, manual, porPersona };
}

/** Impuestos de un resumen: líneas, criterio y cuánto le toca a cada persona. */
export async function impuestosDeResumen(resumenId: number) {
  const r = db().prepare("SELECT * FROM resumenes WHERE id = ?").get(resumenId) as FilaResumenImpuestos | undefined;
  if (!r) return null;
  return calcularImpuestos(r, consumoDeResumen(resumenId));
}

/** Un cargo por persona y por resumen: lo que consumió + su parte de impuestos. */
function cargosDeTodos(): Map<number, Omit<Cargo, "tipo">[]> {
  const resumenes = db().prepare("SELECT * FROM resumenes ORDER BY cierre, id").all() as FilaResumenImpuestos[];
  const cargos = new Map<number, Omit<Cargo, "tipo">[]>();
  for (const r of resumenes) {
    const consumo = consumoDeResumen(r.id);
    const { porPersona: impuestos } = calcularImpuestos(r, consumo);
    for (const id of new Set([...consumo.keys(), ...impuestos.keys()])) {
      const lista = cargos.get(id) ?? [];
      lista.push({
        fecha: r.cierre,
        resumenId: r.id,
        titulo: `${NOMBRE_TARJETA[r.tipo_tarjeta] ?? r.tipo_tarjeta} · cierre ${fechaCorta(r.cierre)}`,
        consumo: consumo.get(id) ?? cero(),
        impuestos: impuestos.get(id) ?? cero(),
      });
      cargos.set(id, lista);
    }
  }
  return cargos;
}

export interface SaldoPersona {
  id: number;
  nombre: string;
  esYo: boolean;
  cargos: Totales;
  pagos: Totales;
  saldo: Totales;
}

/** El saldo de cada persona: todo lo que se le asignó (con impuestos) menos todo lo que pagó. */
export async function saldosPorPersona(): Promise<SaldoPersona[]> {
  const cargos = cargosDeTodos();
  const pagos = pagosDePersona(null);
  return (await listarPersonas()).map((p) => {
    const susCargos = (cargos.get(p.id) ?? []).reduce((t, c) => sumarTotales(t, sumarTotales(c.consumo, c.impuestos)), cero());
    const susPagos = cero();
    for (const pago of pagos) if (pago.personaId === p.id) susPagos[pago.moneda] += pago.centavos;
    return {
      id: p.id,
      nombre: p.nombre,
      esYo: p.es_yo === 1,
      cargos: susCargos,
      pagos: susPagos,
      saldo: { ARS: susCargos.ARS - susPagos.ARS, USD: susCargos.USD - susPagos.USD },
    };
  });
}

/** Todo lo de una persona para su pantalla: movimientos, saldo, cuotas pendientes y gastos por resumen. */
export async function cuentaDePersona(personaId: number) {
  const persona = (await listarPersonas()).find((p) => p.id === personaId);
  if (!persona) return null;

  const movimientos = calcularMovimientos(cargosDeTodos().get(personaId) ?? [], pagosDePersona(personaId));

  // Su parte de cada gasto, agrupada por resumen (para el detalle).
  const filas = db()
    .prepare(
      `SELECT g.resumen_id, g.fecha, g.descripcion, g.cuota_actual, g.cuotas_totales, g.moneda, a.centavos,
              (SELECT COUNT(*) FROM asignaciones a2 WHERE a2.gasto_id = g.id) > 1 AS dividido
       FROM asignaciones a JOIN gastos g ON g.id = a.gasto_id
       WHERE a.persona_id = ? ORDER BY g.resumen_id, g.fecha, g.id`,
    )
    .all(personaId) as {
    resumen_id: number;
    fecha: string;
    descripcion: string;
    cuota_actual: number | null;
    cuotas_totales: number | null;
    moneda: Moneda;
    centavos: number;
    dividido: number;
  }[];
  const gastosPorResumen = new Map<number, GastoDelDetalle[]>();
  for (const f of filas) {
    const lista = gastosPorResumen.get(f.resumen_id) ?? [];
    lista.push({
      fecha: f.fecha,
      descripcion: f.descripcion,
      cuotaActual: f.cuota_actual,
      cuotasTotales: f.cuotas_totales,
      moneda: f.moneda,
      centavos: f.centavos,
      dividido: f.dividido === 1,
    });
    gastosPorResumen.set(f.resumen_id, lista);
  }

  // Cuotas: solo del último resumen importado de cada tarjeta (si no, contaríamos la misma compra varias veces).
  const cuotas = db()
    .prepare(
      `SELECT g.descripcion, r.tipo_tarjeta, g.ultimos_4, g.cuota_actual, g.cuotas_totales, g.moneda, a.centavos
       FROM asignaciones a JOIN gastos g ON g.id = a.gasto_id JOIN resumenes r ON r.id = g.resumen_id
       WHERE a.persona_id = ? AND g.cuota_actual IS NOT NULL
         AND r.cierre = (SELECT MAX(r2.cierre) FROM resumenes r2 WHERE r2.tipo_tarjeta = r.tipo_tarjeta)
       ORDER BY g.cuotas_totales - g.cuota_actual DESC, g.descripcion`,
    )
    .all(personaId) as {
    descripcion: string;
    tipo_tarjeta: string;
    ultimos_4: string;
    cuota_actual: number;
    cuotas_totales: number;
    moneda: Moneda;
    centavos: number;
  }[];
  const pendientes = cuotasPendientes(
    cuotas.map(
      (c): CuotaDeLaPersona => ({
        descripcion: c.descripcion,
        tarjeta: `${NOMBRE_TARJETA[c.tipo_tarjeta] ?? c.tipo_tarjeta} ${c.ultimos_4}`,
        cuotaActual: c.cuota_actual,
        cuotasTotales: c.cuotas_totales,
        moneda: c.moneda,
        centavosPorCuota: c.centavos,
      }),
    ),
  );

  return {
    persona: { id: persona.id, nombre: persona.nombre, esYo: persona.es_yo === 1 },
    movimientos,
    saldo: saldoFinal(movimientos),
    gastosPorResumen,
    cuotas: pendientes,
  };
}
