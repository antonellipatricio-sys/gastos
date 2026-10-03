// Validación: comparamos lo que sumamos nosotros contra lo que dice el banco.
// Si coincide al centavo, sabemos que el parser no se comió ni duplicó ningún gasto.

import type { Totales } from "./santander";

export interface Control {
  nombre: string;
  calculado: Totales;
  banco: Totales | null;
  ok: boolean;
  diferencia: Totales;
}

export function controlar(nombre: string, calculado: Totales, banco: Totales | null): Control {
  const diferencia = banco
    ? { ARS: calculado.ARS - banco.ARS, USD: calculado.USD - banco.USD }
    : { ARS: 0, USD: 0 };
  return {
    nombre,
    calculado,
    banco,
    ok: banco !== null && diferencia.ARS === 0 && diferencia.USD === 0,
    diferencia,
  };
}

export function sumar(...lista: Totales[]): Totales {
  return lista.reduce((a, b) => ({ ARS: a.ARS + b.ARS, USD: a.USD + b.USD }), { ARS: 0, USD: 0 });
}

/** Datos mínimos para validar (sirve tanto para el parser como para lo guardado en la base). */
export interface DatosValidacion {
  tarjetas: { titular: string; ultimos4: string; suma: Totales; subtotalBanco: Totales | null }[];
  totalPagos: Totales;
  saldoAnteriorBanco: Totales | null;
  totalImpuestos: Totales;
  totalAPagarBanco: Totales | null;
}

export function validar(d: DatosValidacion): Control[] {
  const controles = d.tarjetas.map((t) =>
    controlar(`Subtotal de ${t.titular} (terminada en ${t.ultimos4})`, t.suma, t.subtotalBanco),
  );
  controles.push(controlar("Pago anterior y devoluciones (vs. saldo del resumen anterior)", d.totalPagos, d.saldoAnteriorBanco));
  // Chequeo global: saldo anterior + consumos de todas las tarjetas + impuestos = total a pagar.
  const totalCalculado = sumar(d.totalPagos, d.totalImpuestos, ...d.tarjetas.map((t) => t.suma));
  controles.push(controlar("Total a pagar", totalCalculado, d.totalAPagarBanco));
  return controles;
}
