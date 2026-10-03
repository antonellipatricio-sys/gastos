// Saldos: cuánto le toca a cada persona de cada resumen (consumos + impuestos) y cuánto pagó.
// Las cuentas las hace lib/saldos.ts; acá solo se buscan los datos.
import type { Moneda } from "../parser/montos";
import {
  calcularMovimientos,
  cero,
  cuotasPendientes,
  repartirImpuestos,
  saldoFinal,
  sumarTotales,
  type Cargo,
  type CuotaDeLaPersona,
  type GastoDelDetalle,
  type LineaImpuesto,
  type Totales,
} from "../saldos";
import { colecciones, type ResumenDoc } from "./conexion";
import { pagosDePersona } from "./pagos";
import { listarPersonas } from "./personas";

const NOMBRE_TARJETA: Record<string, string> = { VISA: "Visa", AMEX: "American Express" };

function fechaCorta(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

async function idDeVos(): Promise<number> {
  const col = await colecciones();
  const vos = await col.personas.find().sort({ esYo: -1, _id: 1 }).limit(1).next();
  if (!vos) throw new Error("No hay personas cargadas.");
  return vos._id;
}

/**
 * Consumo asignado a cada persona, por resumen (sin impuestos).
 * Una sola consulta para todos los resúmenes pedidos: con la base en internet, menos viajes = más rápido.
 */
async function consumoPorResumen(resumenIds: number[]): Promise<Map<number, Map<number, Totales>>> {
  const col = await colecciones();
  const filas = await col.gastos
    .aggregate<{ _id: { resumenId: number; personaId: number; moneda: Moneda }; centavos: number }>([
      { $match: { resumenId: { $in: resumenIds } } },
      { $unwind: "$partes" },
      {
        $group: {
          _id: { resumenId: "$resumenId", personaId: "$partes.personaId", moneda: "$moneda" },
          centavos: { $sum: "$partes.centavos" },
        },
      },
    ])
    .toArray();
  const resultado = new Map<number, Map<number, Totales>>();
  for (const f of filas) {
    const porPersona = resultado.get(f._id.resumenId) ?? new Map<number, Totales>();
    const t = porPersona.get(f._id.personaId) ?? cero();
    t[f._id.moneda] += f.centavos;
    porPersona.set(f._id.personaId, t);
    resultado.set(f._id.resumenId, porPersona);
  }
  return resultado;
}

function calcularImpuestos(r: ResumenDoc, consumo: Map<number, Totales>, yoId: number) {
  let lineas: LineaImpuesto[] = r.impuestosLineas;
  // Resúmenes importados antes de guardar el detalle de impuestos: solo tenemos el total.
  const sinDetalle = lineas.length === 0 && (r.totalImpuestos.ARS !== 0 || r.totalImpuestos.USD !== 0);
  if (sinDetalle) {
    lineas = (["ARS", "USD"] as const)
      .map((moneda) => ({ descripcion: "Impuestos (total)", moneda, centavos: r.totalImpuestos[moneda] }))
      .filter((l) => l.centavos !== 0);
  }
  const porPersona = repartirImpuestos({
    lineas,
    consumo,
    criterio: r.criterioImpuestos,
    manual: r.impuestosManual,
    yoId,
  });
  return { criterio: r.criterioImpuestos, lineas, sinDetalle, manual: r.impuestosManual, porPersona };
}

/** Impuestos de un resumen: líneas, criterio y cuánto le toca a cada persona. */
export async function impuestosDeResumen(resumenId: number) {
  const col = await colecciones();
  const r = await col.resumenes.findOne({ _id: resumenId });
  if (!r) return null;
  const consumo = (await consumoPorResumen([resumenId])).get(resumenId) ?? new Map();
  return calcularImpuestos(r, consumo, await idDeVos());
}

/** Un cargo por persona y por resumen: lo que consumió + su parte de impuestos. */
async function cargosDeTodos(): Promise<Map<number, Omit<Cargo, "tipo">[]>> {
  const col = await colecciones();
  const resumenes = await col.resumenes.find().sort({ cierre: 1, _id: 1 }).toArray();
  const [consumos, yoId] = await Promise.all([consumoPorResumen(resumenes.map((r) => r._id)), idDeVos()]);
  const cargos = new Map<number, Omit<Cargo, "tipo">[]>();
  for (const r of resumenes) {
    const consumo = consumos.get(r._id) ?? new Map<number, Totales>();
    const { porPersona: impuestos } = calcularImpuestos(r, consumo, yoId);
    for (const id of new Set([...consumo.keys(), ...impuestos.keys()])) {
      const lista = cargos.get(id) ?? [];
      lista.push({
        fecha: r.cierre,
        resumenId: r._id,
        titulo: `${NOMBRE_TARJETA[r.tipo] ?? r.tipo} · cierre ${fechaCorta(r.cierre)}`,
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
  const [cargos, pagos, personas] = await Promise.all([cargosDeTodos(), pagosDePersona(null), listarPersonas()]);
  return personas.map((p) => {
    const susCargos = (cargos.get(p.id) ?? []).reduce(
      (t, c) => sumarTotales(t, sumarTotales(c.consumo, c.impuestos)),
      cero(),
    );
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
  const col = await colecciones();
  const persona = await col.personas.findOne({ _id: personaId });
  if (!persona) return null;

  const [cargos, pagos, susGastos, ultimosCierres] = await Promise.all([
    cargosDeTodos(),
    pagosDePersona(personaId),
    col.gastos.find({ "partes.personaId": personaId }).sort({ resumenId: 1, fecha: 1, _id: 1 }).toArray(),
    col.resumenes
      .aggregate<{ _id: string; cierre: string }>([{ $group: { _id: "$tipo", cierre: { $max: "$cierre" } } }])
      .toArray(),
  ]);
  const movimientos = calcularMovimientos(cargos.get(personaId) ?? [], pagos);
  const suParte = (partes: { personaId: number; centavos: number }[]) =>
    partes.find((p) => p.personaId === personaId)!.centavos;

  // Su parte de cada gasto, agrupada por resumen (para el detalle).
  const gastosPorResumen = new Map<number, GastoDelDetalle[]>();
  for (const g of susGastos) {
    const lista = gastosPorResumen.get(g.resumenId) ?? [];
    lista.push({
      fecha: g.fecha,
      descripcion: g.descripcion,
      cuotaActual: g.cuotaActual,
      cuotasTotales: g.cuotasTotales,
      moneda: g.moneda,
      centavos: suParte(g.partes),
      dividido: g.partes.length > 1,
    });
    gastosPorResumen.set(g.resumenId, lista);
  }

  // Cuotas: solo del último resumen importado de cada tarjeta (si no, contaríamos la misma compra varias veces).
  const esUltimo = (g: { tipo: string; cierre: string }) =>
    ultimosCierres.some((u) => u._id === g.tipo && u.cierre === g.cierre);
  const cuotas: CuotaDeLaPersona[] = susGastos
    .filter((g) => g.cuotaActual !== null && g.cuotasTotales !== null && esUltimo(g))
    .map((g) => ({
      descripcion: g.descripcion,
      tarjeta: `${NOMBRE_TARJETA[g.tipo] ?? g.tipo} ${g.ultimos4}`,
      cuotaActual: g.cuotaActual!,
      cuotasTotales: g.cuotasTotales!,
      moneda: g.moneda,
      centavosPorCuota: suParte(g.partes),
    }))
    .sort(
      (a, b) =>
        b.cuotasTotales - b.cuotaActual - (a.cuotasTotales - a.cuotaActual) ||
        (a.descripcion < b.descripcion ? -1 : a.descripcion > b.descripcion ? 1 : 0),
    );

  return {
    persona: { id: persona._id, nombre: persona.nombre, esYo: persona.esYo },
    movimientos,
    saldo: saldoFinal(movimientos),
    gastosPorResumen,
    cuotas: cuotasPendientes(cuotas),
  };
}
