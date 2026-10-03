// Conexión a la base de datos y creación de tablas.
//
// Usamos @libsql/client, que habla con dos tipos de base:
//   - un archivo SQLite local (en tu compu): DATABASE_URL=file:data/gastos.db (es el default)
//   - Turso, SQLite en la nube (para la versión publicada): DATABASE_URL=libsql://… + DATABASE_AUTH_TOKEN
// El SQL es el mismo en los dos casos; solo cambia dónde vive la base.
import { createClient, type Client, type InArgs, type Transaction } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { mismoNombre } from "../reparto";

// "CREATE TABLE IF NOT EXISTS" hace que esto se pueda correr siempre: la primera vez
// crea las tablas y las siguientes no hace nada. Así, si ya tenías una base de una fase
// anterior, al abrir la app se le agregan solas las tablas nuevas.
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

-- ===== Fase 2 =====

-- Las personas a las que se les asignan gastos.
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  es_yo INTEGER NOT NULL DEFAULT 0       -- 1 = vos (tus gastos no generan deuda en la Fase 3)
);

-- Cada tarjeta física (tipo + últimos 4) y a quién se le asignan sus gastos por defecto.
CREATE TABLE IF NOT EXISTS tarjetas (
  tipo_tarjeta TEXT NOT NULL,
  ultimos_4 TEXT NOT NULL,
  titular TEXT NOT NULL,                 -- el nombre que figura en el resumen
  persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
  PRIMARY KEY (tipo_tarjeta, ultimos_4)
);

-- Quién paga cada gasto. Un gasto puede tener varias filas (dividido entre personas)
-- o ninguna (sin asignar). La suma de las partes es igual al monto del gasto.
-- Los montos van en CENTAVOS ENTEROS para que la suma sea exacta.
CREATE TABLE IF NOT EXISTS asignaciones (
  gasto_id INTEGER NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,
  centavos INTEGER NOT NULL,
  PRIMARY KEY (gasto_id, persona_id)
);
CREATE INDEX IF NOT EXISTS asignaciones_persona ON asignaciones(persona_id);

-- ===== Fase 3 =====

-- Cada línea de "Impuestos, intereses y percepciones" (para repartirlas según su origen).
CREATE TABLE IF NOT EXISTS impuestos_lineas (
  resumen_id INTEGER NOT NULL REFERENCES resumenes(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  moneda TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
  centavos INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS impuestos_lineas_resumen ON impuestos_lineas(resumen_id);

-- Reparto de impuestos cargado a mano (solo cuando el resumen usa el criterio 'manual').
CREATE TABLE IF NOT EXISTS impuestos_manual (
  resumen_id INTEGER NOT NULL REFERENCES resumenes(id) ON DELETE CASCADE,
  persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,
  moneda TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
  centavos INTEGER NOT NULL,
  PRIMARY KEY (resumen_id, persona_id, moneda)
);

-- Pagos que te hace cada persona. "moneda" + "centavos" = qué deuda cancela.
-- Si te pagó dólares con pesos, se guarda además cuántos pesos dio y a qué cotización.
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,                   -- ISO '2026-09-05'
  moneda TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
  centavos INTEGER NOT NULL CHECK (centavos > 0),
  pagado_en_pesos_centavos INTEGER,
  tipo_cambio REAL,
  nota TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pagos_persona ON pagos(persona_id);
`;

// Las personas que se cargan la primera vez (después se pueden editar desde la app).
const PERSONAS_INICIALES: { nombre: string; esYo: boolean }[] = [
  { nombre: "Patricio", esYo: true },
  { nombre: "Mariana", esYo: false },
  { nombre: "Micaela", esYo: false },
  { nombre: "Brenda", esYo: false },
  { nombre: "Banay", esYo: false },
];

// ---------------------------------------------------------------------------
// Ayudantes para no repetir código en cada consulta
// ---------------------------------------------------------------------------

/** Algo que puede ejecutar SQL: la conexión normal o una transacción abierta. */
export type Ejecutor = Client | Transaction;

/** Todas las filas de una consulta, como objetos { columna: valor }. */
export async function todas<T>(ej: Ejecutor, sql: string, args: InArgs = []): Promise<T[]> {
  const r = await ej.execute({ sql, args });
  return r.rows.map((fila) => Object.fromEntries(r.columns.map((c, i) => [c, fila[i]])) as T);
}

/** La primera fila de una consulta (o undefined si no hay ninguna). */
export async function una<T>(ej: Ejecutor, sql: string, args: InArgs = []): Promise<T | undefined> {
  return (await todas<T>(ej, sql, args))[0];
}

/** Ejecuta un INSERT/UPDATE/DELETE. Devuelve el id insertado y cuántas filas cambió. */
export async function ejecutar(ej: Ejecutor, sql: string, args: InArgs = []) {
  const r = await ej.execute({ sql, args });
  return { id: Number(r.lastInsertRowid ?? 0), cambios: r.rowsAffected };
}

/** Corre varias operaciones como una sola: si alguna falla, no se guarda ninguna. */
export async function enTransaccion<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await (await db()).transaction("write");
  try {
    const resultado = await fn(tx);
    await tx.commit();
    return resultado;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

function urlBase(): string {
  return process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "gastos.db")}`;
}

// En desarrollo Next recarga los módulos seguido; guardamos la conexión (ya preparada)
// en globalThis para no abrir una nueva ni repetir las migraciones en cada recarga.
const global = globalThis as unknown as { __db?: Promise<Client> };

export function db(): Promise<Client> {
  global.__db ??= abrir().catch((e) => {
    global.__db = undefined; // si falló (ej. sin internet), que el próximo intento vuelva a probar
    throw e;
  });
  return global.__db;
}

async function abrir(): Promise<Client> {
  const url = urlBase();
  if (url.startsWith("file:")) {
    fs.mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  }
  const cliente = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  if (url.startsWith("file:")) await cliente.execute("PRAGMA journal_mode = WAL");
  await cliente.executeMultiple(ESQUEMA);
  // Fase 3: cómo se reparten los impuestos de cada resumen ('proporcional' | 'yo' | 'manual').
  await agregarColumna(cliente, "resumenes", "criterio_impuestos", "TEXT NOT NULL DEFAULT 'proporcional'");

  const hay = await una<{ n: number }>(cliente, "SELECT COUNT(*) AS n FROM personas");
  if (hay!.n === 0) {
    for (const p of PERSONAS_INICIALES) {
      await ejecutar(cliente, "INSERT INTO personas (nombre, es_yo) VALUES (?, ?)", [p.nombre, p.esYo ? 1 : 0]);
    }
  }
  await migrarTarjetasFaltantes(cliente);
  return cliente;
}

/** Agrega una columna a una tabla existente si todavía no la tiene (SQLite no tiene "ADD COLUMN IF NOT EXISTS"). */
async function agregarColumna(cliente: Client, tabla: string, columna: string, definicion: string) {
  const columnas = await todas<{ name: string }>(cliente, `PRAGMA table_info(${tabla})`);
  if (!columnas.some((c) => c.name === columna)) {
    await cliente.execute(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}

/**
 * Migración para bases creadas en la Fase 1: registra las tarjetas de los resúmenes ya
 * importados que todavía no están en la tabla "tarjetas", les sugiere dueño por el nombre
 * del titular y le asigna los gastos sin asignar. Si no falta ninguna, no hace nada.
 */
async function migrarTarjetasFaltantes(cliente: Client) {
  const faltantes = await todas<{ tipo_tarjeta: string; ultimos_4: string; titular: string }>(
    cliente,
    `SELECT DISTINCT r.tipo_tarjeta, s.ultimos_4, s.titular
     FROM subtotales s JOIN resumenes r ON r.id = s.resumen_id
     WHERE NOT EXISTS (SELECT 1 FROM tarjetas t
                       WHERE t.tipo_tarjeta = r.tipo_tarjeta AND t.ultimos_4 = s.ultimos_4)`,
  );
  if (faltantes.length === 0) return;

  const personas = await todas<{ id: number; nombre: string }>(cliente, "SELECT id, nombre FROM personas");
  const tx = await cliente.transaction("write");
  try {
    for (const t of faltantes) {
      const duenio = personas.find((p) => mismoNombre(t.titular, p.nombre))?.id ?? null;
      await ejecutar(
        tx,
        "INSERT OR IGNORE INTO tarjetas (tipo_tarjeta, ultimos_4, titular, persona_id) VALUES (?, ?, ?, ?)",
        [t.tipo_tarjeta, t.ultimos_4, t.titular, duenio],
      );
      if (duenio === null) continue;
      await ejecutar(
        tx,
        `INSERT INTO asignaciones (gasto_id, persona_id, centavos)
         SELECT g.id, ?, CAST(ROUND(g.monto * 100) AS INTEGER)
         FROM gastos g JOIN resumenes r ON r.id = g.resumen_id
         WHERE r.tipo_tarjeta = ? AND g.ultimos_4 = ?
           AND NOT EXISTS (SELECT 1 FROM asignaciones a WHERE a.gasto_id = g.id)`,
        [duenio, t.tipo_tarjeta, t.ultimos_4],
      );
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

/** Solo para tests: cierra la conexión para poder abrir otra base. */
export async function cerrarDb() {
  const abierta = global.__db;
  global.__db = undefined;
  (await abierta)?.close();
}

// --- Conversión centavos (cálculos) ↔ pesos (columnas REAL de la Fase 1) ---
export const aPesos = (centavos: number) => centavos / 100;
export const aCentavos = (pesos: number) => Math.round(pesos * 100);
