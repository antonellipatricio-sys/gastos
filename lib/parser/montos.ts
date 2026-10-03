// Utilidades para leer números y fechas en formato argentino.
//
// Trabajamos en CENTAVOS ENTEROS (151.554,44 → 15155444) porque los decimales
// en JavaScript no son exactos (0.1 + 0.2 = 0.30000000000000004). Con enteros,
// sumar y comparar contra el subtotal del banco da exacto al centavo.

export type Moneda = "ARS" | "USD";

export interface Monto {
  moneda: Moneda;
  centavos: number;
}

/** "151.554,44" → 15155444 (centavos). */
export function parsearNumero(texto: string): number {
  const limpio = texto.replace(/\./g, "").replace(",", ".");
  const valor = Number(limpio);
  if (Number.isNaN(valor)) throw new Error(`No se pudo leer el número "${texto}"`);
  return Math.round(valor * 100);
}

/** Un monto tal como aparece en el PDF: "$ 151.554,44", "-$ 39.682,26", "U$S 6,00", "-U$S 120,09". */
const MONTO = String.raw`(-?)(U\$S|\$) ?(\d{1,3}(?:\.\d{3})*,\d{2})`;

/** Uno o más montos pegados al final de una línea (ej. "$ 182.536,80 -U$S 120,09"). */
export const MONTOS_AL_FINAL = new RegExp(String.raw`((?:\s+${MONTO})+)\s*$`);

/** Lee todos los montos de un texto como "$ 182.536,80 -U$S 120,09". */
export function parsearMontos(texto: string): Monto[] {
  const montos: Monto[] = [];
  for (const m of texto.matchAll(new RegExp(MONTO, "g"))) {
    const signo = m[1] === "-" ? -1 : 1;
    montos.push({
      moneda: m[2] === "U$S" ? "USD" : "ARS",
      centavos: signo * parsearNumero(m[3]),
    });
  }
  return montos;
}

/** Separa una línea en { resto, montos } si termina en montos; si no, devuelve null. */
export function separarMontosAlFinal(linea: string): { resto: string; montos: Monto[] } | null {
  const m = linea.match(MONTOS_AL_FINAL);
  if (!m) return null;
  return { resto: linea.slice(0, m.index).trim(), montos: parsearMontos(m[1]) };
}

/** Suma de una lista de montos, separada por moneda. */
export function sumarPorMoneda(montos: Monto[]): { ARS: number; USD: number } {
  const total = { ARS: 0, USD: 0 };
  for (const m of montos) total[m.moneda] += m.centavos;
  return total;
}

/** "27/08/26" → "2026-08-27" (formato ISO: ordena bien y lo entiende cualquier base de datos). */
export function fechaIso(ddmmaa: string): string {
  const [d, m, a] = ddmmaa.split("/");
  const anio = a.length === 2 ? `20${a}` : a;
  return `${anio}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** "2026-08-27" → "27/08/26" para mostrar en pantalla. */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return a ? `${d}/${m}/${a.slice(2)}` : "";
}

/** "8 de 9" → { actual: 8, totales: 9 }. */
export function parsearCuota(texto: string | undefined): { actual: number | null; totales: number | null } {
  const m = texto?.match(/(\d+)\s+de\s+(\d+)/);
  return m ? { actual: Number(m[1]), totales: Number(m[2]) } : { actual: null, totales: null };
}

/** Centavos → "$ 1.134.490,06" / "U$S 58,19" para mostrar en pantalla. */
export function formatear(centavos: number, moneda: Moneda): string {
  const texto = (Math.abs(centavos) / 100).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${centavos < 0 ? "-" : ""}${moneda === "USD" ? "U$S" : "$"} ${texto}`;
}
