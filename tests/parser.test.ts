// Tests del parser contra los PDFs reales de la carpeta resumenes/.
// Esa carpeta está en .gitignore (datos personales), así que si no existe los tests
// que la necesitan se saltean en vez de fallar.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extraerTexto } from "../lib/pdf";
import { parsearCuota, parsearMontos, parsearNumero, fechaIso } from "../lib/parser/montos";
import { parsearResumen, type Resumen } from "../lib/parser/santander";
import { validar } from "../lib/parser/validar";
import { sumarPorMoneda } from "../lib/parser/montos";

describe("montos", () => {
  it("lee el formato argentino en centavos", () => {
    expect(parsearNumero("151.554,44")).toBe(15155444);
    expect(parsearNumero("0,01")).toBe(1);
  });
  it("detecta moneda y signo", () => {
    expect(parsearMontos("$ 182.536,80 -U$S 120,09")).toEqual([
      { moneda: "ARS", centavos: 18253680 },
      { moneda: "USD", centavos: -12009 },
    ]);
  });
  it("lee cuotas y fechas", () => {
    expect(parsearCuota("8 de 9")).toEqual({ actual: 8, totales: 9 });
    expect(parsearCuota(undefined)).toEqual({ actual: null, totales: null });
    expect(fechaIso("27/08/26")).toBe("2026-08-27");
  });
});

describe("parser con texto armado a mano", () => {
  const texto = [
    "Resumen Visa N° 1",
    "Cierre", "anterior", "30/07/26", "Cierre", "actual", "27/08/26", "Vencimiento", "actual", "04/09/26",
    "Movimientos de Fulano",
    "Visa crédito terminada en 1111",
    "23/01/26 Comercio uno 8 de 9 216619 $ 1.000,50",
    "=Descripcion con igual 123456 U$S 2,00",
    "05/08/26 Seguro de",
    "vivi0000512190060-021-012",
    "005559 $ 79.364,53",
    "Subtotal de Fulano $ 80.365,03 U$S 2,00",
  ].join("\n");
  const r = parsearResumen(texto);
  const g = r.tarjetas[0].gastos;

  it("arma las filas", () => {
    expect(r.tipo).toBe("VISA");
    expect(r.cierre).toBe("2026-08-27");
    expect(g).toHaveLength(3);
    expect(g[0]).toMatchObject({ descripcion: "Comercio uno", cuotaActual: 8, cuotasTotales: 9, comprobante: "216619" });
  });
  it("hereda la fecha y guarda el '=' tal cual", () => {
    expect(g[1]).toMatchObject({ fecha: "2026-01-23", descripcion: "=Descripcion con igual", moneda: "USD", centavos: 200 });
  });
  it("une descripciones de dos líneas", () => {
    expect(g[2]).toMatchObject({ fecha: "2026-08-05", descripcion: "Seguro de vivi0000512190060-021-012", comprobante: "005559" });
  });
});

const VISA = path.join(__dirname, "..", "resumenes", "visa-2026-09.pdf");

describe.skipIf(!fs.existsSync(VISA))("resumen Visa real (04-09-2026)", () => {
  let r: Resumen;
  beforeAll(async () => {
    r = parsearResumen(await extraerTexto(new Uint8Array(fs.readFileSync(VISA))));
  });
  const total = (u4: string) => sumarPorMoneda(r.tarjetas.find((t) => t.ultimos4 === u4)!.gastos);

  it("encabezado", () => {
    expect(r).toMatchObject({ tipo: "VISA", cierre: "2026-08-27", vencimiento: "2026-09-04" });
    expect(r.tarjetas.map((t) => t.ultimos4)).toEqual(["1204", "8337", "3946"]);
    expect(r.advertencias).toEqual([]);
  });
  it("totales por tarjeta", () => {
    expect(total("1204")).toEqual({ ARS: 113449006, USD: 5819 });
    expect(total("8337")).toEqual({ ARS: 78483448, USD: 0 });
    expect(total("3946")).toEqual({ ARS: 22089898, USD: 1870 });
  });
  it("pagos e impuestos", () => {
    expect(r.totalPagos).toEqual({ ARS: -6063070, USD: 0 });
    expect(r.totalImpuestos).toEqual({ ARS: 10353356, USD: 0 });
  });
  it("todas las validaciones dan OK", () => {
    const controles = validar({
      ...r,
      tarjetas: r.tarjetas.map((t) => ({ ...t, suma: sumarPorMoneda(t.gastos) })),
    });
    expect(controles.filter((c) => !c.ok)).toEqual([]);
  });
  it("fila de seguro de 2 líneas", () => {
    const g = r.tarjetas[0].gastos.find((x) => x.comprobante === "004131")!;
    expect(g).toMatchObject({ fecha: "2026-08-05", centavos: 17329872 });
    // La segunda línea (nº de póliza) quedó unida a la primera.
    expect(g.descripcion).toMatch(/^Sancor coop se\d+/);
  });
});

const AMEX = path.join(__dirname, "..", "resumenes", "amex.pdf");

describe.skipIf(!fs.existsSync(AMEX))("resumen American Express real (07-09-2026)", () => {
  let r: Resumen;
  beforeAll(async () => {
    r = parsearResumen(await extraerTexto(new Uint8Array(fs.readFileSync(AMEX))));
  });
  const total = (u4: string) => sumarPorMoneda(r.tarjetas.find((t) => t.ultimos4 === u4)!.gastos);

  it("encabezado", () => {
    expect(r).toMatchObject({ tipo: "AMEX", cierre: "2026-08-27", vencimiento: "2026-09-07" });
    expect(r.advertencias).toEqual([]);
  });
  it("mismo titular con dos tarjetas: se separan por últimos 4", () => {
    expect(r.tarjetas.map((t) => t.ultimos4)).toEqual(["0616", "0029"]);
    expect(r.tarjetas[0].titular).toBe(r.tarjetas[1].titular);
    expect(total("0616")).toEqual({ ARS: 29231489, USD: 5997 });
    expect(total("0029")).toEqual({ ARS: 0, USD: 11637 });
  });
  it("descripciones con '=' se guardan tal cual", () => {
    expect(r.tarjetas[0].gastos.map((g) => g.descripcion)).toContain("=dlospotify");
  });
  it("pagos, impuestos y validaciones", () => {
    expect(r.totalPagos).toEqual({ ARS: 0, USD: 0 });
    expect(r.totalImpuestos).toEqual({ ARS: 8794448, USD: 0 });
    const controles = validar({
      ...r,
      tarjetas: r.tarjetas.map((t) => ({ ...t, suma: sumarPorMoneda(t.gastos) })),
    });
    expect(controles.filter((c) => !c.ok)).toEqual([]);
  });
});
