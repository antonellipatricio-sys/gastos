// Conexión a SQLite. La base es un único archivo: data/gastos.db (en .gitignore).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Resumen, Totales } from "./parser/santander";
import type { DatosValidacion } from "./parser/validar";

const CARPETA = path.join(process.cwd(), "data");
const ARCHIVO = path.join(CARPETA, "gastos.db");

// "CREATE TABLE IF NOT EXISTS" hace que esto se pueda correr siempre: la primera vez
// crea las tablas y las siguientes no hace nada.
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS resumenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_tarjeta TEXT NOT NULL,            -- 'VISA' | 'AMEX'
  periodo TEXT NOT NULL,                 -- '30/07/26 – 27/08/26'
  cierre TEXT NOT NULL,                  -- ISO '2026-08-27'
  vencimiento TEXT NOT NULL,
  total_impuestos_pesos REAL NOT NULL DEFAULT 0,
  total_impuestos_dolares REAL NOT NULL DEFAULT 0,
  -- Totales de control (para poder re-mostrar la validación sin el PDF)
  total_pagos_pesos REAL NOT NULL DEFAULT 0,
  total_pagos_dolares REAL NOT NULL DEFAULT 0,
  saldo_anterior_pesos REAL,
  saldo_anterior_dolares REAL,
  total_a_pagar_pesos REAL,
  total_a_pagar_dolares REAL,
  importado_en TEXT NOT NULL DEFAULT (datetime('now')),
  -- Un mismo resumen no se puede importar dos veces
  UNIQUE (tipo_tarjeta, cierre)
);

CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resumen_id INTEGER NOT NULL REFERENCES resumenes(id) ON DELETE CASCADE,
  titular TEXT NOT NULL,
  ultimos_4 TEXT NOT NULL,
  fecha TEXT NOT NULL,                   -- ISO '2026-08-05'
  descripcion TEXT NOT NULL,
  cuota_actual INTEGER,
  cuotas_totales INTEGER,
  comprobante TEXT,
  moneda TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
  monto REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS gastos_resumen ON gastos(resumen_id);

-- Lo que dice el banco en "Subtotal de X", por tarjeta (para la validación)
CREATE TABLE IF NOT EXISTS subtotales (
  resumen_id INTEGER NOT NULL REFERENCES resumenes(id) ON DELETE CASCADE,
  ultimos_4 TEXT NOT NULL,
  titular TEXT NOT NULL,
  pesos REAL,
  dolares REAL,
  PRIMARY KEY (resumen_id, ultimos_4)
);
`;

// En desarrollo Next recarga los módulos seguido; guardamos la conexión en globalThis
// para no abrir una nueva en cada recarga.
const global = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (!global.__db) {
    fs.mkdirSync(CARPETA, { recursive: true });
    const conexion = new Database(ARCHIVO);
    conexion.pragma("journal_mode = WAL");
    conexion.pragma("foreign_keys = ON");
    conexion.exec(ESQUEMA);
    global.__db = conexion;
  }
  return global.__db;
}

// Todas las funciones de acceso a datos son async aunque better-sqlite3 sea sincrónico:
// el día que la app se publique con una base en la nube (Postgres, Turso), las consultas
// van a ser asincrónicas y así las pantallas no hay que tocarlas.

// --- Conversión centavos (parser) ↔ pesos (base) ---
const aPesos = (centavos: number) => centavos / 100;
const aCentavos = (pesos: number) => Math.round(pesos * 100);
const totalesDe = (ars: number | null, usd: number | null): Totales | null =>
  ars === null || usd === null ? null : { ARS: aCentavos(ars), USD: aCentavos(usd) };

export interface FilaResumen {
  id: number;
  tipo_tarjeta: string;
  periodo: string;
  cierre: string;
  vencimiento: string;
  total_impuestos_pesos: number;
  total_impuestos_dolares: number;
  total_pagos_pesos: number;
  total_pagos_dolares: number;
  saldo_anterior_pesos: number | null;
  saldo_anterior_dolares: number | null;
  total_a_pagar_pesos: number | null;
  total_a_pagar_dolares: number | null;
}

export interface FilaGasto {
  id: number;
  titular: string;
  ultimos_4: string;
  fecha: string;
  descripcion: string;
  cuota_actual: number | null;
  cuotas_totales: number | null;
  comprobante: string | null;
  moneda: "ARS" | "USD";
  monto: number;
}

export async function buscarResumen(tipo: string, cierre: string): Promise<{ id: number } | undefined> {
  return db()
    .prepare("SELECT id FROM resumenes WHERE tipo_tarjeta = ? AND cierre = ?")
    .get(tipo, cierre) as { id: number } | undefined;
}

/** Guarda el resumen y todos sus gastos en UNA transacción: o se guarda todo, o nada. */
export async function guardarResumen(r: Resumen): Promise<number> {
  const conexion = db();
  const guardar = conexion.transaction(() => {
    const { lastInsertRowid } = conexion
      .prepare(
        `INSERT INTO resumenes (tipo_tarjeta, periodo, cierre, vencimiento,
           total_impuestos_pesos, total_impuestos_dolares, total_pagos_pesos, total_pagos_dolares,
           saldo_anterior_pesos, saldo_anterior_dolares, total_a_pagar_pesos, total_a_pagar_dolares)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.tipo, r.periodo, r.cierre, r.vencimiento,
        aPesos(r.totalImpuestos.ARS), aPesos(r.totalImpuestos.USD),
        aPesos(r.totalPagos.ARS), aPesos(r.totalPagos.USD),
        r.saldoAnteriorBanco ? aPesos(r.saldoAnteriorBanco.ARS) : null,
        r.saldoAnteriorBanco ? aPesos(r.saldoAnteriorBanco.USD) : null,
        r.totalAPagarBanco ? aPesos(r.totalAPagarBanco.ARS) : null,
        r.totalAPagarBanco ? aPesos(r.totalAPagarBanco.USD) : null,
      );
    const resumenId = Number(lastInsertRowid);

    const insertarGasto = conexion.prepare(
      `INSERT INTO gastos (resumen_id, titular, ultimos_4, fecha, descripcion, cuota_actual,
         cuotas_totales, comprobante, moneda, monto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertarSubtotal = conexion.prepare(
      "INSERT INTO subtotales (resumen_id, ultimos_4, titular, pesos, dolares) VALUES (?, ?, ?, ?, ?)",
    );
    for (const t of r.tarjetas) {
      insertarSubtotal.run(
        resumenId, t.ultimos4, t.titular,
        t.subtotalBanco ? aPesos(t.subtotalBanco.ARS) : null,
        t.subtotalBanco ? aPesos(t.subtotalBanco.USD) : null,
      );
      for (const g of t.gastos) {
        insertarGasto.run(
          resumenId, t.titular, t.ultimos4, g.fecha, g.descripcion, g.cuotaActual,
          g.cuotasTotales, g.comprobante, g.moneda, aPesos(g.centavos),
        );
      }
    }
    return resumenId;
  });
  return guardar();
}

export async function listarResumenes(): Promise<(FilaResumen & { cantidad_gastos: number })[]> {
  return db()
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM gastos g WHERE g.resumen_id = r.id) AS cantidad_gastos
       FROM resumenes r ORDER BY r.cierre DESC, r.tipo_tarjeta`,
    )
    .all() as (FilaResumen & { cantidad_gastos: number })[];
}

export async function obtenerResumen(id: number) {
  const resumen = db().prepare("SELECT * FROM resumenes WHERE id = ?").get(id) as FilaResumen | undefined;
  if (!resumen) return null;
  const gastos = db()
    .prepare("SELECT * FROM gastos WHERE resumen_id = ? ORDER BY id")
    .all(id) as FilaGasto[];
  const subtotales = db()
    .prepare("SELECT * FROM subtotales WHERE resumen_id = ? ORDER BY rowid")
    .all(id) as { ultimos_4: string; titular: string; pesos: number | null; dolares: number | null }[];

  // Agrupamos por tarjeta (titular + últimos 4), respetando el orden del resumen.
  const tarjetas = subtotales.map((s) => {
    const suyos = gastos.filter((g) => g.ultimos_4 === s.ultimos_4);
    const suma = { ARS: 0, USD: 0 };
    for (const g of suyos) suma[g.moneda] += aCentavos(g.monto);
    return {
      titular: s.titular,
      ultimos4: s.ultimos_4,
      gastos: suyos,
      suma,
      subtotalBanco: totalesDe(s.pesos, s.dolares),
    };
  });

  const validacion: DatosValidacion = {
    tarjetas,
    totalPagos: { ARS: aCentavos(resumen.total_pagos_pesos), USD: aCentavos(resumen.total_pagos_dolares) },
    saldoAnteriorBanco: totalesDe(resumen.saldo_anterior_pesos, resumen.saldo_anterior_dolares),
    totalImpuestos: { ARS: aCentavos(resumen.total_impuestos_pesos), USD: aCentavos(resumen.total_impuestos_dolares) },
    totalAPagarBanco: totalesDe(resumen.total_a_pagar_pesos, resumen.total_a_pagar_dolares),
  };
  return { resumen, tarjetas, validacion };
}
