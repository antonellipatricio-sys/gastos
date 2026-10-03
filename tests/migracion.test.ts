// Test de scripts/migrar-a-mongo.mjs: una base SQLite con el formato de las versiones
// anteriores se copia a MongoDB y la app ve exactamente los mismos datos.
import { createClient } from "@libsql/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrar } from "../scripts/migrar-a-mongo.mjs";

process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = "test_migracion";

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "gastos-migracion-"));
const archivo = path.join(carpeta, "vieja.db");

// El formato de la base SQLite de las fases 1 a 3 (solo las columnas que importan).
const VIEJA = `
CREATE TABLE personas (id INTEGER PRIMARY KEY, nombre TEXT, es_yo INTEGER);
CREATE TABLE tarjetas (tipo_tarjeta TEXT, ultimos_4 TEXT, titular TEXT, persona_id INTEGER);
CREATE TABLE resumenes (id INTEGER PRIMARY KEY, tipo_tarjeta TEXT, periodo TEXT, cierre TEXT, vencimiento TEXT,
  total_impuestos_pesos REAL, total_impuestos_dolares REAL, total_pagos_pesos REAL, total_pagos_dolares REAL,
  saldo_anterior_pesos REAL, saldo_anterior_dolares REAL, total_a_pagar_pesos REAL, total_a_pagar_dolares REAL,
  importado_en TEXT, criterio_impuestos TEXT);
CREATE TABLE gastos (id INTEGER PRIMARY KEY, resumen_id INTEGER, titular TEXT, ultimos_4 TEXT, fecha TEXT,
  descripcion TEXT, cuota_actual INTEGER, cuotas_totales INTEGER, comprobante TEXT, moneda TEXT, monto REAL);
CREATE TABLE subtotales (resumen_id INTEGER, ultimos_4 TEXT, titular TEXT, pesos REAL, dolares REAL);
CREATE TABLE asignaciones (gasto_id INTEGER, persona_id INTEGER, centavos INTEGER);
CREATE TABLE impuestos_lineas (resumen_id INTEGER, descripcion TEXT, moneda TEXT, centavos INTEGER);
CREATE TABLE impuestos_manual (resumen_id INTEGER, persona_id INTEGER, moneda TEXT, centavos INTEGER);
CREATE TABLE pagos (id INTEGER PRIMARY KEY, persona_id INTEGER, fecha TEXT, moneda TEXT, centavos INTEGER,
  pagado_en_pesos_centavos INTEGER, tipo_cambio REAL, nota TEXT, creado_en TEXT);

INSERT INTO personas VALUES (1, 'Patricio', 1), (3, 'Micaela', 0), (7, 'Juan', 0);
INSERT INTO tarjetas VALUES ('VISA', '8337', 'Micaela Boggio Diaz', 3);
INSERT INTO resumenes VALUES (4, 'VISA', '30/07/26 – 27/08/26', '2026-08-27', '2026-09-04',
  1000.00, 0, -50.00, 0, -50.00, 0, 4150.50, 10.00, '2026-10-03 12:00:00', 'proporcional');
INSERT INTO subtotales VALUES (4, '8337', 'Micaela Boggio Diaz', 3200.50, 10.00);
INSERT INTO gastos VALUES
  (10, 4, 'Micaela Boggio Diaz', '8337', '2026-06-02', 'Flores', 3, 6, '048527', 'ARS', 3000.00),
  (11, 4, 'Micaela Boggio Diaz', '8337', '2026-08-24', 'Cp*facturas claro', NULL, NULL, '016516', 'ARS', 200.50),
  (12, 4, 'Micaela Boggio Diaz', '8337', '2026-08-15', 'Spotify', NULL, NULL, '945508', 'USD', 10.00);
INSERT INTO asignaciones VALUES (10, 3, 150000), (10, 1, 150000), (11, 3, 20050), (12, 3, 1000);
INSERT INTO impuestos_lineas VALUES (4, 'Intereses financiacion $', 'ARS', 100000);
INSERT INTO pagos VALUES (2, 3, '2026-09-05', 'ARS', 50000, NULL, NULL, 'Transferencia', '2026-09-05 10:00:00');
`;

describe("migración SQLite → MongoDB", () => {
  let dbMod: typeof import("../lib/db");

  beforeAll(async () => {
    const sqlite = createClient({ url: `file:${archivo}` });
    await sqlite.executeMultiple(VIEJA);
    sqlite.close();
    dbMod = await import("../lib/db");
    // La app abre la base primero (crea índices y las personas iniciales): la migración las reemplaza.
    await dbMod.listarPersonas();
  });
  afterAll(async () => {
    await (await import("../lib/db/conexion")).cerrarDb();
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it("copia todo conservando los ids", async () => {
    const copiados = await migrar({ archivo, mongoUri: process.env.MONGODB_URI, base: "test_migracion" });
    expect(copiados).toEqual({ personas: 3, tarjetas: 1, resumenes: 1, gastos: 3, pagos: 1 });
    expect((await dbMod.listarPersonas()).map((p) => [p.id, p.nombre])).toEqual([[1, "Patricio"], [7, "Juan"], [3, "Micaela"]]);
  });

  it("la app ve los mismos datos y saldos", async () => {
    const r = (await dbMod.obtenerResumen(4))!;
    expect(r.resumen.total_a_pagar_pesos).toBe(4150.5);
    expect(r.tarjetas[0].gastos.map((g) => [g.id, g.monto])).toEqual([[10, 3000], [11, 200.5], [12, 10]]);
    // Micaela: $1.500 (su mitad de Flores) + $200,50 + su parte de intereses − $500 de pago, y U$S 10.
    // Los intereses se reparten entre ella y Patricio según lo que gastó cada uno en pesos.
    const imp = (await dbMod.impuestosDeResumen(4))!;
    const micaelaImp = imp.porPersona.get(3)!.ARS;
    expect(micaelaImp + imp.porPersona.get(1)!.ARS).toBe(100000);
    const micaela = (await dbMod.saldosPorPersona()).find((s) => s.id === 3)!;
    expect(micaela.saldo).toEqual({ ARS: 150000 + 20050 + micaelaImp - 50000, USD: 1000 });
  });

  it("los ids nuevos siguen después de los migrados", async () => {
    const id = await dbMod.crearPersona("Brenda");
    expect(id).toBe(8);
  });

  it("no migra dos veces", async () => {
    await expect(migrar({ archivo, mongoUri: process.env.MONGODB_URI, base: "test_migracion" })).rejects.toThrow(
      /ya tiene resumenes/,
    );
  });
});
