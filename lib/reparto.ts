// Cuentas para repartir un gasto entre personas. Todo en centavos enteros.
// No toca la base de datos: así se puede testear sola y reusar en cualquier pantalla.

export interface Parte {
  personaId: number;
  centavos: number;
}

/**
 * Divide un monto en n partes iguales sin perder centavos.
 * $100,00 entre 3 → 33,34 + 33,33 + 33,33 (los centavos sobrantes van a las primeras partes).
 */
export function partesIguales(centavos: number, personaIds: number[]): Parte[] {
  const n = personaIds.length;
  if (n === 0) return [];
  const base = Math.trunc(centavos / n);
  let resto = centavos - base * n; // puede ser negativo si el gasto es una devolución
  return personaIds.map((personaId) => {
    const extra = resto === 0 ? 0 : Math.sign(resto);
    resto -= extra;
    return { personaId, centavos: base + extra };
  });
}

/**
 * Copia un reparto a otro monto respetando las proporciones.
 * Se usa cuando una cuota hereda el reparto de la anterior (normalmente el monto es igual,
 * pero si cambió, cada persona mantiene su porcentaje).
 */
export function escalarReparto(partes: Parte[], nuevoTotal: number): Parte[] {
  const totalAnterior = partes.reduce((s, p) => s + p.centavos, 0);
  if (partes.length === 0) return [];
  if (totalAnterior === nuevoTotal) return partes.map((p) => ({ ...p }));
  if (totalAnterior === 0) return partesIguales(nuevoTotal, partes.map((p) => p.personaId));

  const escaladas = partes.map((p) => ({
    personaId: p.personaId,
    centavos: Math.round((p.centavos * nuevoTotal) / totalAnterior),
  }));
  // El redondeo puede dejar 1 o 2 centavos de diferencia: se corrigen en la última parte.
  const diferencia = nuevoTotal - escaladas.reduce((s, p) => s + p.centavos, 0);
  escaladas[escaladas.length - 1].centavos += diferencia;
  return escaladas;
}

/** Revisa que un reparto sea válido para un gasto: suma exacta y sin personas repetidas. */
export function validarReparto(partes: Parte[], totalGasto: number): string | null {
  if (partes.length === 0) return null; // vacío = "sin asignar", es válido
  const ids = new Set(partes.map((p) => p.personaId));
  if (ids.size !== partes.length) return "Hay una persona repetida en el reparto.";
  if (partes.some((p) => !Number.isInteger(p.centavos))) return "Los montos tienen que tener como máximo 2 decimales.";
  const suma = partes.reduce((s, p) => s + p.centavos, 0);
  if (suma !== totalGasto) {
    const f = (c: number) => (c / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Las partes suman ${f(suma)} y el gasto es de ${f(totalGasto)}.`;
  }
  return null;
}

/** "Micaela Boggio Diaz" vs "Micaela" → true. Compara sin tildes ni mayúsculas, por primer nombre. */
export function mismoNombre(titular: string, persona: string): boolean {
  const normalizar = (s: string) =>
    s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const primero = normalizar(titular).split(/\s+/)[0];
  return primero.length > 0 && primero === normalizar(persona).split(/\s+/)[0];
}
