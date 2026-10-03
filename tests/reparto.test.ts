// Tests de la Fase 2: repartos y asignación automática al importar.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { escalarReparto, mismoNombre, partesIguales, validarReparto } from "../lib/reparto";
import type { Resumen } from "../lib/parser/santander";

describe("cuentas de reparto", () => {
  it("partes iguales sin perder centavos", () => {
    expect(partesIguales(10000, [1, 2, 3]).map((p) => p.centavos)).toEqual([3334, 3333, 3333]);
    expect(partesIguales(-10000, [1, 2, 3]).map((p) => p.centavos)).toEqual([-3334, -3333, -3333]);
    expect(partesIguales(500, [7])).toEqual([{ personaId: 7, centavos: 500 }]);
  });
  it("escalar un reparto a otro monto mantiene proporciones y suma exacta", () => {
    const partes = escalarReparto([{ personaId: 1, centavos: 3000 }, { personaId: 2, centavos: 1000 }], 10001);
    expect(partes.reduce((s, p) => s + p.centavos, 0)).toBe(10001);
    expect(partes[0].centavos).toBe(7501);
  });
  it("valida suma y repetidos", () => {
    expect(validarReparto([{ personaId: 1, centavos: 100 }], 100)).toBeNull();
    expect(validarReparto([], 100)).toBeNull();
    expect(validarReparto([{ personaId: 1, centavos: 99 }], 100)).toMatch(/suman/);
    expect(validarReparto([{ personaId: 1, centavos: 50 }, { personaId: 1, centavos: 50 }], 100)).toMatch(/repetida/);
  });
  it("reconoce al titular por el primer nombre", () => {
    expect(mismoNombre("Micaela Boggio Diaz", "Micaela")).toBe(true);
    expect(mismoNombre("MARIANA L ANTONELLI", "mariana")).toBe(true);
    expect(mismoNombre("Mariana L Antonelli", "Micaela")).toBe(false);
    expect(mismoNombre("JOSÉ PÉREZ", "Jose")).toBe(true);
  });
});

// --- Integración con el MongoDB en memoria de los tests (ver tests/mongo-global.ts) ---
process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = "test_reparto";

// Importamos después de fijar MONGODB_URI para que la conexión use la base de prueba.
const dbMod = await import("../lib/db");
const { cerrarDb, colecciones } = await import("../lib/db/conexion");

function resumen(cierre: string, gastos: Resumen["tarjetas"][number]["gastos"], titular = "Micaela Boggio Diaz"): Resumen {
  return {
    tipo: "VISA",
    periodo: cierre,
    cierre,
    vencimiento: cierre,
    tarjetas: [{ titular, ultimos4: "8337", gastos, subtotalBanco: null }],
    totalPagos: { ARS: 0, USD: 0 },
    saldoAnteriorBanco: null,
    totalImpuestos: { ARS: 0, USD: 0 },
    impuestos: [],
    totalAPagarBanco: null,
    advertencias: [],
  };
}
const gasto = (descripcion: string, centavos: number, cuota: [number, number] | null = null) => ({
  fecha: "2026-08-01",
  descripcion,
  cuotaActual: cuota?.[0] ?? null,
  cuotasTotales: cuota?.[1] ?? null,
  comprobante: "000001",
  moneda: "ARS" as const,
  centavos,
});

describe("asignación al importar", () => {
  let agosto: number;
  beforeAll(async () => {
    agosto = await dbMod.guardarResumen(
      resumen("2026-08-27", [gasto("Flores", 900000, [3, 6]), gasto("Merpago*coto", 6143156)]),
    );
  });
  afterAll(async () => {
    await cerrarDb();
  });

  it("carga las personas iniciales", async () => {
    const nombres = (await dbMod.listarPersonas()).map((p) => p.nombre);
    expect(nombres).toEqual(["Patricio", "Banay", "Brenda", "Mariana", "Micaela"]);
  });

  it("sugiere el dueño de la tarjeta por el nombre y le asigna los gastos", async () => {
    const micaela = (await dbMod.listarPersonas()).find((p) => p.nombre === "Micaela")!;
    const [tarjeta] = await dbMod.listarTarjetas();
    expect(tarjeta).toMatchObject({ ultimos_4: "8337", persona_id: micaela.id });
    const { porPersona, sinAsignar } = (await dbMod.obtenerResumen(agosto))!;
    expect(porPersona.get(micaela.id)).toEqual({ ARS: 900000 + 6143156, USD: 0 });
    expect(sinAsignar).toEqual({ ARS: 0, USD: 0 });
  });

  it("la cuota siguiente hereda el reparto (dividido)", async () => {
    const personas = await dbMod.listarPersonas();
    const id = (n: string) => personas.find((p) => p.nombre === n)!.id;
    // Dividimos "Flores 3 de 6" entre Micaela y Patricio.
    const flores = (await dbMod.obtenerResumen(agosto))!.tarjetas[0].gastos.find((g) => g.descripcion === "Flores")!;
    await dbMod.asignarGasto(flores.id, partesIguales(900000, [id("Micaela"), id("Patricio")]));

    const septiembre = await dbMod.guardarResumen(
      resumen("2026-09-27", [gasto("Flores", 900000, [4, 6]), gasto("Spotify", 499000)]),
    );
    const gastos = (await dbMod.obtenerResumen(septiembre))!.tarjetas[0].gastos;
    expect(gastos.find((g) => g.descripcion === "Flores")!.partes).toEqual([
      { personaId: id("Micaela"), centavos: 450000 },
      { personaId: id("Patricio"), centavos: 450000 },
    ]);
    // Lo que no es cuota va al dueño de la tarjeta.
    expect(gastos.find((g) => g.descripcion === "Spotify")!.partes).toEqual([
      { personaId: id("Micaela"), centavos: 499000 },
    ]);
  });

  it("no acepta un reparto que no suma el total", async () => {
    const g = (await dbMod.obtenerResumen(agosto))!.tarjetas[0].gastos[1];
    await expect(dbMod.asignarGasto(g.id, [{ personaId: 1, centavos: 1 }])).rejects.toThrow(/suman/);
  });

  it("asignar dueño a una tarjeta completa solo los gastos sin asignar", async () => {
    const g = (await dbMod.obtenerResumen(agosto))!.tarjetas[0].gastos[1];
    await dbMod.asignarGasto(g.id, []); // lo dejamos sin asignar
    const banay = (await dbMod.listarPersonas()).find((p) => p.nombre === "Banay")!;
    const asignados = await dbMod.asignarDuenioTarjeta("VISA", "8337", banay.id);
    expect(asignados).toBe(1);
    const guardado = await (await colecciones()).gastos.findOne({ _id: g.id });
    expect(guardado!.partes).toEqual([{ personaId: banay.id, centavos: guardado!.centavos }]);
  });
});
