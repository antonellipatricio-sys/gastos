// Cuentas de la Fase 3: impuestos por persona, saldos, cuotas pendientes y el texto para mandar.
// Igual que lib/reparto.ts: no toca la base de datos, todo en centavos enteros.

import { fechaCorta, formatear, type Moneda } from "./parser/montos";

export interface Totales {
  ARS: number;
  USD: number;
}

export const cero = (): Totales => ({ ARS: 0, USD: 0 });
export const sumarTotales = (a: Totales, b: Totales): Totales => ({ ARS: a.ARS + b.ARS, USD: a.USD + b.USD });
export const restarTotales = (a: Totales, b: Totales): Totales => ({ ARS: a.ARS - b.ARS, USD: a.USD - b.USD });

// ---------------------------------------------------------------------------
// Reparto proporcional
// ---------------------------------------------------------------------------

/**
 * Reparte un monto según pesos relativos sin perder centavos (método de restos mayores):
 * cada uno recibe la parte entera de su proporción y los centavos que sobran van a quienes
 * tenían la parte decimal más grande. Los pesos negativos cuentan como 0.
 * Devuelve null si todos los pesos son 0.
 */
export function repartirProporcional(total: number, pesos: [number, number][]): Map<number, number> | null {
  const validos = pesos.map(([id, p]) => [id, Math.max(0, p)] as [number, number]).filter(([, p]) => p > 0);
  const sumaPesos = validos.reduce((s, [, p]) => s + p, 0);
  if (sumaPesos === 0) return null;

  const signo = total < 0 ? -1 : 1;
  const absoluto = Math.abs(total);
  const partes = validos.map(([id, p]) => {
    const exacto = (absoluto * p) / sumaPesos;
    return { id, entero: Math.floor(exacto), resto: exacto - Math.floor(exacto) };
  });
  let sobrante = absoluto - partes.reduce((s, x) => s + x.entero, 0);
  for (const x of [...partes].sort((a, b) => b.resto - a.resto)) {
    if (sobrante === 0) break;
    x.entero += 1;
    sobrante -= 1;
  }
  return new Map(partes.map((x) => [x.id, signo * x.entero]));
}

// ---------------------------------------------------------------------------
// Impuestos
// ---------------------------------------------------------------------------

export type CriterioImpuestos = "proporcional" | "yo" | "manual";

export interface LineaImpuesto {
  descripcion: string;
  moneda: Moneda;
  centavos: number;
}

export interface ImpuestoManual {
  personaId: number;
  moneda: Moneda;
  centavos: number;
}

/**
 * ¿La línea es una percepción sobre consumos en dólares / servicios del exterior?
 * RG 5617 (30% sobre consumos en moneda extranjera), IVA RG 4240 (servicios digitales del exterior)
 * y las percepciones de IIBB. El resto (intereses y su IVA) se reparte por consumo en pesos.
 */
export function esPorDolares(descripcion: string): boolean {
  return /5617|4240|percep/i.test(descripcion);
}

function agregar(mapa: Map<number, Totales>, id: number, moneda: Moneda, centavos: number) {
  const t = mapa.get(id) ?? cero();
  t[moneda] += centavos;
  mapa.set(id, t);
}

/** Cuánto de los impuestos de un resumen le toca a cada persona, según el criterio elegido. */
export function repartirImpuestos(args: {
  lineas: LineaImpuesto[];
  consumo: Map<number, Totales>;
  criterio: CriterioImpuestos;
  manual: ImpuestoManual[];
  yoId: number;
}): Map<number, Totales> {
  const resultado = new Map<number, Totales>();
  const { lineas, consumo, criterio, manual, yoId } = args;

  if (criterio === "manual") {
    for (const m of manual) agregar(resultado, m.personaId, m.moneda, m.centavos);
    return resultado;
  }
  for (const linea of lineas) {
    if (criterio === "yo") {
      agregar(resultado, yoId, linea.moneda, linea.centavos);
      continue;
    }
    // Proporcional: según el consumo que generó la línea; si no hubo, según la otra moneda; si no, a vos.
    const base: Moneda = esPorDolares(linea.descripcion) ? "USD" : "ARS";
    const otra: Moneda = base === "USD" ? "ARS" : "USD";
    const pesosDe = (m: Moneda) => [...consumo].map(([id, t]) => [id, t[m]] as [number, number]);
    const reparto =
      repartirProporcional(linea.centavos, pesosDe(base)) ??
      repartirProporcional(linea.centavos, pesosDe(otra)) ??
      new Map([[yoId, linea.centavos]]);
    for (const [id, centavos] of reparto) agregar(resultado, id, linea.moneda, centavos);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Movimientos y saldo
// ---------------------------------------------------------------------------

export interface Cargo {
  tipo: "cargo";
  fecha: string; // ISO: el cierre del resumen
  resumenId: number;
  titulo: string; // "Visa · cierre 27/08/26"
  consumo: Totales;
  impuestos: Totales;
}

export interface Pago {
  tipo: "pago";
  id: number;
  fecha: string; // ISO
  moneda: Moneda;
  centavos: number; // lo que cancela, en la moneda de la deuda
  pagadoEnPesos: number | null; // si pagó dólares con pesos: cuántos pesos dio
  tipoCambio: number | null;
  nota: string | null;
}

export type Movimiento = (Cargo | Pago) & { saldo: Totales };

/** Ordena cargos y pagos por fecha y calcula el saldo acumulado después de cada uno. */
export function calcularMovimientos(cargos: Omit<Cargo, "tipo">[], pagos: Omit<Pago, "tipo">[]): Movimiento[] {
  const todos: (Cargo | Pago)[] = [
    ...cargos.map((c) => ({ ...c, tipo: "cargo" as const })),
    ...pagos.map((p) => ({ ...p, tipo: "pago" as const })),
  ];
  // Por fecha; el mismo día, primero el cargo y después el pago.
  todos.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === "cargo" ? -1 : 1) - (b.tipo === "cargo" ? -1 : 1));
  let saldo = cero();
  return todos.map((m) => {
    if (m.tipo === "cargo") saldo = sumarTotales(saldo, sumarTotales(m.consumo, m.impuestos));
    else saldo = { ...saldo, [m.moneda]: saldo[m.moneda] - m.centavos };
    return { ...m, saldo };
  });
}

/** Saldo final: lo que te debe (positivo) o lo que tiene a favor (negativo). */
export function saldoFinal(movimientos: Movimiento[]): Totales {
  return movimientos.at(-1)?.saldo ?? cero();
}

// ---------------------------------------------------------------------------
// Cuotas pendientes
// ---------------------------------------------------------------------------

export interface CuotaDeLaPersona {
  descripcion: string;
  tarjeta: string;
  cuotaActual: number;
  cuotasTotales: number;
  moneda: Moneda;
  centavosPorCuota: number; // la parte de la persona en una cuota
}

export interface CuotaPendiente extends CuotaDeLaPersona {
  faltan: number;
  totalPendiente: number;
}

export function cuotasPendientes(cuotas: CuotaDeLaPersona[]): { lista: CuotaPendiente[]; total: Totales } {
  const lista = cuotas
    .filter((c) => c.cuotaActual < c.cuotasTotales)
    .map((c) => {
      const faltan = c.cuotasTotales - c.cuotaActual;
      return { ...c, faltan, totalPendiente: faltan * c.centavosPorCuota };
    });
  const total = cero();
  for (const c of lista) total[c.moneda] += c.totalPendiente;
  return { lista, total };
}

// ---------------------------------------------------------------------------
// Texto para mandar por WhatsApp
// ---------------------------------------------------------------------------

export interface GastoDelDetalle {
  fecha: string;
  descripcion: string;
  cuotaActual: number | null;
  cuotasTotales: number | null;
  moneda: Moneda;
  centavos: number; // la parte de la persona
  dividido: boolean;
}

function montos(t: Totales, siempre: boolean = true): string {
  const partes: string[] = [];
  if (t.ARS !== 0 || siempre) partes.push(formatear(t.ARS, "ARS"));
  if (t.USD !== 0) partes.push(formatear(t.USD, "USD"));
  return partes.join(" + ");
}

/**
 * Arma el detalle desde una fecha: lo anterior se resume en "Saldo anterior".
 * Usa *negrita* de WhatsApp.
 */
export function armarDetalle(args: {
  nombre: string;
  movimientos: Movimiento[];
  desde: string | null; // ISO; null = desde el principio
  gastosPorResumen: Map<number, GastoDelDetalle[]>;
}): string {
  const { nombre, movimientos, desde, gastosPorResumen } = args;
  const anteriores = desde ? movimientos.filter((m) => m.fecha < desde) : [];
  const incluidos = desde ? movimientos.filter((m) => m.fecha >= desde) : movimientos;
  const saldoAnterior = saldoFinal(anteriores);
  const lineas: string[] = [`Hola ${nombre}! Te paso el detalle de las tarjetas:`, ""];

  if (saldoAnterior.ARS !== 0 || saldoAnterior.USD !== 0) {
    lineas.push(`Saldo anterior: ${montos(saldoAnterior)}`, "");
  }
  for (const m of incluidos) {
    if (m.tipo === "cargo") {
      lineas.push(`*${m.titulo}*`);
      for (const g of gastosPorResumen.get(m.resumenId) ?? []) {
        const cuota = g.cuotaActual !== null ? ` (${g.cuotaActual}/${g.cuotasTotales})` : "";
        const dividido = g.dividido ? " (tu parte)" : "";
        lineas.push(`• ${fechaCorta(g.fecha).slice(0, 5)} ${g.descripcion}${cuota}${dividido}: ${formatear(g.centavos, g.moneda)}`);
      }
      if (m.impuestos.ARS !== 0 || m.impuestos.USD !== 0) {
        lineas.push(`• Impuestos e intereses: ${montos(m.impuestos, false)}`);
      }
      lineas.push(`Subtotal: ${montos(sumarTotales(m.consumo, m.impuestos))}`, "");
    } else {
      const enPesos =
        m.pagadoEnPesos !== null ? ` (pagado con ${formatear(m.pagadoEnPesos, "ARS")} a ${m.tipoCambio})` : "";
      lineas.push(`Pago del ${fechaCorta(m.fecha)}: -${formatear(m.centavos, m.moneda)}${enPesos}`, "");
    }
  }
  const saldo = saldoFinal(movimientos);
  lineas.push(saldo.ARS !== 0 || saldo.USD !== 0 ? `*Saldo: ${montos(saldo)}*` : "*Estás al día* 🙌");
  return lineas.join("\n");
}
