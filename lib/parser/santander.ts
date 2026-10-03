// Parser de resúmenes de tarjeta Santander (Visa / American Express).
//
// Recibe el TEXTO que sale de pdf-parse y devuelve los datos estructurados.
// Ojo: en estos PDFs, si se mira la posición en la página, la columna de montos
// está dibujada en orden invertido. Pero el texto que entrega pdf-parse sigue el
// orden interno del archivo, donde cada fila trae su monto correcto en la misma
// línea. Por eso leemos línea por línea y no por coordenadas.

import {
  fechaIso,
  parsearCuota,
  parsearMontos,
  separarMontosAlFinal,
  sumarPorMoneda,
  type Monto,
  type Moneda,
} from "./montos";

export type TipoTarjeta = "VISA" | "AMEX";

export interface Gasto {
  fecha: string; // ISO "2026-08-27"
  descripcion: string;
  cuotaActual: number | null;
  cuotasTotales: number | null;
  comprobante: string | null;
  moneda: Moneda;
  centavos: number;
}

export interface Totales {
  ARS: number; // centavos
  USD: number; // centavos
}

export interface Tarjeta {
  titular: string;
  ultimos4: string;
  gastos: Gasto[];
  /** Lo que dice la línea "Subtotal de X" del banco (null si no apareció). */
  subtotalBanco: Totales | null;
}

export interface Resumen {
  tipo: TipoTarjeta;
  /** "30/07/26 – 27/08/26": desde el cierre anterior hasta el cierre actual. */
  periodo: string;
  cierre: string; // ISO
  vencimiento: string; // ISO
  tarjetas: Tarjeta[];
  /** Suma de las líneas de "Pago anterior y devoluciones". */
  totalPagos: Totales;
  /** Lo que dice el banco en "Saldo del resumen anterior" (debería coincidir con totalPagos). */
  saldoAnteriorBanco: Totales | null;
  /** Suma de las líneas de "Impuestos, intereses y percepciones". */
  totalImpuestos: Totales;
  /** "Total a pagar" del banco. */
  totalAPagarBanco: Totales | null;
  /** Líneas que el parser no supo interpretar (para avisar en pantalla). */
  advertencias: string[];
}

// Líneas que se repiten en cada página y no aportan datos.
const IGNORAR = [
  /^Copia fiel de car/i,
  /^-- \d+ of \d+ --$/,
  /^Fecha\s+Descripci/i,
];

const FECHA = /^(\d{2}\/\d{2}\/\d{2})\s*/;

/**
 * Lo que queda de una fila una vez sacados los montos del final:
 *   "23/01/26 Merpago*erexit 8 de 9 216619"  → fecha, descripción, cuota, comprobante
 *   "004131"                                  → solo comprobante (fila de 2 líneas)
 * La descripción es "perezosa" (.*?) para que la cuota y el comprobante del final
 * no queden pegados a la descripción.
 */
const FILA = /^(.*?)(?:\s*\b(\d+ de \d+))?(?:\s*\b(\d{6}))?$/;

function totales(montos: Monto[]): Totales {
  return sumarPorMoneda(montos);
}

function buscarFecha(texto: string, etiqueta: RegExp): string | null {
  const m = texto.match(new RegExp(etiqueta.source + String.raw`\s+(\d{2}\/\d{2}\/\d{2})`, "i"));
  return m ? m[1] : null;
}

export function detectarTipo(texto: string): TipoTarjeta | null {
  if (/Resumen\s+American\s+Express/i.test(texto)) return "AMEX";
  if (/Resumen\s+Visa/i.test(texto)) return "VISA";
  return null;
}

export function parsearResumen(texto: string): Resumen {
  const tipo = detectarTipo(texto);
  if (!tipo) {
    throw new Error('No parece un resumen Santander: no encontré "Resumen Visa" ni "Resumen American Express".');
  }

  const cierreAnterior = buscarFecha(texto, /Cierre\s+anterior/);
  const cierre = buscarFecha(texto, /Cierre\s+actual/);
  const vencimiento = buscarFecha(texto, /Vencimiento\s+actual/);
  if (!cierre || !vencimiento) {
    throw new Error("No encontré las fechas de cierre y vencimiento actuales en el resumen.");
  }

  const resumen: Resumen = {
    tipo,
    periodo: cierreAnterior ? `${cierreAnterior} – ${cierre}` : cierre,
    cierre: fechaIso(cierre),
    vencimiento: fechaIso(vencimiento),
    tarjetas: [],
    totalPagos: { ARS: 0, USD: 0 },
    saldoAnteriorBanco: null,
    totalImpuestos: { ARS: 0, USD: 0 },
    totalAPagarBanco: null,
    advertencias: [],
  };

  type Seccion = "ninguna" | "pagos" | "movimientos" | "impuestos";
  let seccion: Seccion = "ninguna";
  let tarjeta: Tarjeta | null = null;
  let ultimaFecha: string | null = null;
  // Líneas de descripción que todavía no tienen monto (filas de 2+ líneas).
  let pendiente: string[] = [];
  let fechaPendiente: string | null = null;
  const montosPagos: Monto[] = [];
  const montosImpuestos: Monto[] = [];

  const lineas = texto.split(/\r?\n/).map((l) => l.trim());

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!linea || IGNORAR.some((re) => re.test(linea))) continue;

    // --- Cambios de sección ---
    if (/^Pago anterior y devoluciones/i.test(linea)) {
      seccion = "pagos";
      continue;
    }
    if (/^Saldo del resumen anterior/i.test(linea)) {
      resumen.saldoAnteriorBanco = totales(parsearMontos(linea));
      seccion = "ninguna";
      continue;
    }
    if (/^Impuestos, intereses y percepciones/i.test(linea)) {
      seccion = "impuestos";
      continue;
    }
    const movimientos = linea.match(/^Movimientos de (.+)$/i);
    if (movimientos) {
      // La sección se identifica por los últimos 4 dígitos, que vienen en la línea siguiente
      // ("Visa crédito terminada en 1204"). El nombre es solo un dato descriptivo.
      const siguiente = lineas.slice(i + 1, i + 4).find((l) => /terminada en \d{4}/i.test(l));
      const ultimos4 = siguiente?.match(/terminada en (\d{4})/i)?.[1];
      if (!ultimos4) {
        resumen.advertencias.push(`No encontré "terminada en XXXX" para "${linea}".`);
        seccion = "ninguna";
        continue;
      }
      tarjeta = resumen.tarjetas.find((t) => t.ultimos4 === ultimos4) ?? null;
      if (!tarjeta) {
        tarjeta = { titular: movimientos[1].trim(), ultimos4, gastos: [], subtotalBanco: null };
        resumen.tarjetas.push(tarjeta);
      }
      seccion = "movimientos";
      pendiente = [];
      fechaPendiente = null;
      continue;
    }
    if (/terminada en \d{4}/i.test(linea) && seccion === "movimientos") continue;
    if (/^Subtotal de /i.test(linea)) {
      if (tarjeta) tarjeta.subtotalBanco = totales(parsearMontos(linea));
      if (pendiente.length) {
        resumen.advertencias.push(`Descripción sin monto en ${tarjeta?.titular}: "${pendiente.join(" ")}"`);
      }
      seccion = "ninguna";
      tarjeta = null;
      pendiente = [];
      continue;
    }
    if (/^Total a pagar\b/i.test(linea)) {
      const montos = parsearMontos(linea);
      if (montos.length) resumen.totalAPagarBanco = totales(montos);
      seccion = "ninguna";
      continue;
    }

    // --- Contenido de cada sección ---
    if (seccion === "pagos" || seccion === "impuestos") {
      const separado = separarMontosAlFinal(linea);
      if (separado) (seccion === "pagos" ? montosPagos : montosImpuestos).push(...separado.montos);
      continue;
    }

    if (seccion === "movimientos" && tarjeta) {
      const separado = separarMontosAlFinal(linea);
      if (!separado) {
        // Línea sin monto: es el comienzo (o la continuación) de una descripción de varias líneas.
        const conFecha = linea.match(FECHA);
        if (conFecha && pendiente.length === 0) {
          fechaPendiente = conFecha[1];
          pendiente.push(linea.slice(conFecha[0].length));
        } else {
          pendiente.push(linea);
        }
        continue;
      }

      // Línea con monto: cierra la fila.
      let resto = separado.resto;
      let fecha = fechaPendiente;
      const conFecha = resto.match(FECHA);
      if (conFecha) {
        fecha = conFecha[1];
        resto = resto.slice(conFecha[0].length);
      }
      const [, desc = "", cuotaTxt, comprobante] = resto.match(FILA) ?? [];
      const descripcion = [...pendiente, desc].map((s) => s.trim()).filter(Boolean).join(" ");

      // Si el renglón no tiene fecha, usa la del renglón anterior.
      const fechaFinal: string | null = fecha ?? ultimaFecha;
      if (!fechaFinal) {
        resumen.advertencias.push(`Gasto sin fecha: "${linea}"`);
      }
      ultimaFecha = fechaFinal;

      const cuota = parsearCuota(cuotaTxt);
      for (const monto of separado.montos) {
        tarjeta.gastos.push({
          fecha: fechaFinal ? fechaIso(fechaFinal) : "",
          descripcion,
          cuotaActual: cuota.actual,
          cuotasTotales: cuota.totales,
          comprobante: comprobante ?? null,
          moneda: monto.moneda,
          centavos: monto.centavos,
        });
      }
      pendiente = [];
      fechaPendiente = null;
    }
  }

  resumen.totalPagos = totales(montosPagos);
  resumen.totalImpuestos = totales(montosImpuestos);
  return resumen;
}
