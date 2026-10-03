// Tests de la Fase 3: reparto de impuestos, saldos, pagos, cuotas pendientes y el detalle.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  armarDetalle,
  calcularMovimientos,
  cuotasPendientes,
  esPorDolares,
  repartirImpuestos,
  repartirProporcional,
  type Totales,
} from "../lib/saldos";

describe("reparto proporcional", () => {
  it("suma exacto y reparte los centavos sobrantes", () => {
    const r = repartirProporcional(10000, [[1, 1], [2, 1], [3, 1]])!;
    expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(10000);
    expect([...r.values()].sort()).toEqual([3333, 3333, 3334]);
  });
  it("ignora pesos 0 o negativos y devuelve null si no hay base", () => {
    expect(repartirProporcional(100, [[1, 0], [2, -5], [3, 10]])).toEqual(new Map([[3, 100]]));
    expect(repartirProporcional(100, [[1, 0]])).toBeNull();
  });
  it("funciona con montos negativos", () => {
    const r = repartirProporcional(-1001, [[1, 1], [2, 1]])!;
    expect(r.get(1)! + r.get(2)!).toBe(-1001);
  });
});

describe("impuestos", () => {
  const consumo = new Map<number, Totales>([
    [1, { ARS: 1000, USD: 300 }], // vos
    [2, { ARS: 3000, USD: 0 }], // sin dólares
    [3, { ARS: 0, USD: 100 }],
  ]);
  const lineas = [
    { descripcion: "Db.rg 5617 30% ( 116411,46 )", moneda: "ARS" as const, centavos: 4000 },
    { descripcion: "Intereses financiacion $", moneda: "ARS" as const, centavos: 800 },
  ];

  it("clasifica las percepciones sobre dólares", () => {
    expect(esPorDolares("Db.rg 5617 30% ( 116411,46 )")).toBe(true);
    expect(esPorDolares("Iva rg 4240 21%( 38743,26)")).toBe(true);
    expect(esPorDolares("Iibb percep-caba 2,00%( 38743,26)")).toBe(true);
    expect(esPorDolares("Intereses financiacion $")).toBe(false);
    expect(esPorDolares("Db iva $ 21% 3")).toBe(false);
  });
  it("proporcional: percepciones por consumo en dólares, intereses por consumo en pesos", () => {
    const r = repartirImpuestos({ lineas, consumo, criterio: "proporcional", manual: [], yoId: 1 });
    // 5617: 4000 repartido 300/100 entre 1 y 3. Intereses: 800 repartido 1000/3000 entre 1 y 2.
    expect(r.get(1)).toEqual({ ARS: 3000 + 200, USD: 0 });
    expect(r.get(2)).toEqual({ ARS: 600, USD: 0 });
    expect(r.get(3)).toEqual({ ARS: 1000, USD: 0 });
  });
  it("'los pago yo' y manual", () => {
    expect(repartirImpuestos({ lineas, consumo, criterio: "yo", manual: [], yoId: 1 })).toEqual(
      new Map([[1, { ARS: 4800, USD: 0 }]]),
    );
    const manual = [{ personaId: 2, moneda: "ARS" as const, centavos: 4800 }];
    expect(repartirImpuestos({ lineas, consumo, criterio: "manual", manual, yoId: 1 })).toEqual(
      new Map([[2, { ARS: 4800, USD: 0 }]]),
    );
  });
});

describe("movimientos, cuotas y detalle", () => {
  const cargos = [
    { fecha: "2026-08-27", resumenId: 1, titulo: "Visa · cierre 27/08/26", consumo: { ARS: 100000, USD: 1000 }, impuestos: { ARS: 5000, USD: 0 } },
  ];
  const pagos = [
    { id: 1, fecha: "2026-09-05", moneda: "ARS" as const, centavos: 60000, pagadoEnPesos: null, tipoCambio: null, nota: null },
    // Pagó U$S 10 con $15.000 a 1.500
    { id: 2, fecha: "2026-09-06", moneda: "USD" as const, centavos: 1000, pagadoEnPesos: 1500000, tipoCambio: 1500, nota: null },
  ];
  const movs = calcularMovimientos(cargos, pagos);

  it("saldo acumulado", () => {
    expect(movs.map((m) => m.saldo)).toEqual([
      { ARS: 105000, USD: 1000 },
      { ARS: 45000, USD: 1000 },
      { ARS: 45000, USD: 0 },
    ]);
  });
  it("cuotas pendientes", () => {
    const r = cuotasPendientes([
      { descripcion: "Flores", tarjeta: "Visa 8337", cuotaActual: 3, cuotasTotales: 6, moneda: "ARS", centavosPorCuota: 1000 },
      { descripcion: "Assist", tarjeta: "Visa 8337", cuotaActual: 6, cuotasTotales: 6, moneda: "ARS", centavosPorCuota: 500 },
    ]);
    expect(r.lista).toHaveLength(1);
    expect(r.lista[0]).toMatchObject({ faltan: 3, totalPendiente: 3000 });
    expect(r.total).toEqual({ ARS: 3000, USD: 0 });
  });
  it("texto del detalle", () => {
    const texto = armarDetalle({
      nombre: "Micaela",
      movimientos: movs,
      desde: null,
      gastosPorResumen: new Map([
        [1, [{ fecha: "2026-08-12", descripcion: "Merpago*coto", cuotaActual: 1, cuotasTotales: 2, moneda: "ARS", centavos: 100000, dividido: true }]],
      ]),
    });
    expect(texto).toContain("Hola Micaela!");
    expect(texto).toContain("• 12/08 Merpago*coto (1/2) (tu parte): $ 1.000,00");
    expect(texto).toContain("Pago del 06/09/26: -U$S 10,00 (pagado con $ 15.000,00 a 1500)");
    expect(texto).toContain("*Saldo: $ 450,00*");
  });
  it("detalle desde una fecha: lo anterior va como saldo anterior", () => {
    const texto = armarDetalle({ nombre: "M", movimientos: movs, desde: "2026-09-06", gastosPorResumen: new Map() });
    expect(texto).toContain("Saldo anterior: $ 450,00 + U$S 10,00");
    expect(texto).not.toContain("Visa · cierre");
  });
});

// --- Integración con el resumen Visa real y el MongoDB en memoria de los tests ---
const VISA = path.join(__dirname, "..", "resumenes", "visa-2026-09.pdf");
process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = "test_saldos";

describe.skipIf(!fs.existsSync(VISA))("saldos con el resumen Visa real", () => {
  let dbMod: typeof import("../lib/db");
  let resumenId: number;
  let id: (nombre: string) => number;

  beforeAll(async () => {
    dbMod = await import("../lib/db");
    const { extraerTexto } = await import("../lib/pdf");
    const { parsearResumen } = await import("../lib/parser/santander");
    resumenId = await dbMod.guardarResumen(parsearResumen(await extraerTexto(new Uint8Array(fs.readFileSync(VISA)))));
    const personas = await dbMod.listarPersonas();
    id = (n) => personas.find((p) => p.nombre === n)!.id;
  });
  afterAll(async () => {
    await (await import("../lib/db/conexion")).cerrarDb();
  });

  it("guarda las 9 líneas de impuestos y el reparto proporcional suma exacto", async () => {
    const imp = (await dbMod.impuestosDeResumen(resumenId))!;
    expect(imp.lineas).toHaveLength(9);
    expect(imp.sinDetalle).toBe(false);
    const suma = [...imp.porPersona.values()].reduce((s, t) => s + t.ARS, 0);
    expect(suma).toBe(10353356);
    // Micaela no consumió dólares: solo le tocan intereses + IVA sobre intereses ($ 45.533,62 en total),
    // en proporción a su consumo en pesos.
    expect(imp.porPersona.get(id("Micaela"))!.ARS).toBeLessThan(4553362);
    expect(imp.porPersona.get(id("Micaela"))!.ARS).toBeGreaterThan(0);
  });

  it("saldo de Micaela = consumos + impuestos − pagos", async () => {
    const imp = (await dbMod.impuestosDeResumen(resumenId))!;
    const suyos = imp.porPersona.get(id("Micaela"))!.ARS;
    const antes = (await dbMod.saldosPorPersona()).find((s) => s.nombre === "Micaela")!;
    expect(antes.saldo).toEqual({ ARS: 78483448 + suyos, USD: 0 });

    await dbMod.registrarPago({
      personaId: id("Micaela"), fecha: "2026-09-05", moneda: "ARS", centavos: 50000000,
      pagadoEnPesos: null, tipoCambio: null, nota: null,
    });
    const despues = (await dbMod.saldosPorPersona()).find((s) => s.nombre === "Micaela")!;
    expect(despues.saldo.ARS).toBe(78483448 + suyos - 50000000);
  });

  it("'los pago yo' le pasa todos los impuestos a Patricio", async () => {
    await dbMod.cambiarCriterioImpuestos(resumenId, "yo");
    const imp = (await dbMod.impuestosDeResumen(resumenId))!;
    expect([...imp.porPersona.keys()]).toEqual([id("Patricio")]);
    await dbMod.cambiarCriterioImpuestos(resumenId, "proporcional");
  });

  it("manual: rechaza un reparto que no suma el total", async () => {
    await expect(
      dbMod.guardarImpuestosManual(resumenId, [{ personaId: id("Mariana"), moneda: "ARS", centavos: 1 }]),
    ).rejects.toThrow(/deberían sumar/);
  });

  it("cuotas pendientes de Micaela (del último resumen)", async () => {
    const cuenta = (await dbMod.cuentaDePersona(id("Micaela")))!;
    // pompavana 7/9, Nike 5/6, fedora 4/6, Flores 3/6, ameliemur 1/2 (assist365 6/6 ya terminó)
    expect(cuenta.cuotas.lista.map((c) => [c.descripcion, c.faltan])).toEqual([
      ["Flores", 3],
      ["Dlo*fedora shoes", 2],
      ["Merpago*pompavana", 2],
      ["Merpago*ameliemur", 1],
      ["Nike arcos", 1],
    ]);
  });

  it("borrar el resumen se lleva sus gastos e impuestos", async () => {
    await dbMod.borrarResumen(resumenId);
    expect(await dbMod.impuestosDeResumen(resumenId)).toBeNull();
    const micaela = (await dbMod.saldosPorPersona()).find((s) => s.nombre === "Micaela")!;
    expect(micaela.cargos).toEqual({ ARS: 0, USD: 0 });
    expect(micaela.saldo.ARS).toBe(-50000000); // el pago queda: ahora está a favor
  });
});
