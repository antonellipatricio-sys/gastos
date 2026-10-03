// Conexión a SQLite y creación de tablas.
// La base es un único archivo: data/gastos.db (en .gitignore). Los tests usan otro
// archivo, indicado con la variable de entorno GASTOS_DB, para no tocar tus datos.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { mismoNombre } from "../reparto";

// "CREATE TABLE IF NOT EXISTS" hace que esto se pueda correr siempre: la primera vez
// crea las tablas y las siguientes no hace nada. Así, si ya tenías una base de la
// Fase 1, al abrir la app se le agregan solas las tablas nuevas.
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
`;

// Las personas que se cargan la primera vez (después se pueden editar desde la app).
const PERSONAS_INICIALES: { nombre: string; esYo: boolean }[] = [
  { nombre: "Patricio", esYo: true },
  { nombre: "Mariana", esYo: false },
  { nombre: "Micaela", esYo: false },
  { nombre: "Brenda", esYo: false },
  { nombre: "Banay", esYo: false },
];

function rutaBase(): string {
  return process.env.GASTOS_DB ?? path.join(process.cwd(), "data", "gastos.db");
}

// En desarrollo Next recarga los módulos seguido; guardamos la conexión en globalThis
// para no abrir una nueva en cada recarga.
const global = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (!global.__db) {
    const archivo = rutaBase();
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const conexion = new Database(archivo);
    conexion.pragma("journal_mode = WAL");
    conexion.pragma("foreign_keys = ON");
    conexion.exec(ESQUEMA);

    const hayPersonas = conexion.prepare("SELECT COUNT(*) AS n FROM personas").get() as { n: number };
    if (hayPersonas.n === 0) {
      const insertar = conexion.prepare("INSERT INTO personas (nombre, es_yo) VALUES (?, ?)");
      for (const p of PERSONAS_INICIALES) insertar.run(p.nombre, p.esYo ? 1 : 0);
    }
    migrarTarjetasFaltantes(conexion);
    global.__db = conexion;
  }
  return global.__db;
}

/**
 * Migración para bases creadas en la Fase 1: registra las tarjetas de los resúmenes ya
 * importados que todavía no están en la tabla "tarjetas", les sugiere dueño por el nombre
 * del titular y le asigna los gastos sin asignar. Si no falta ninguna, no hace nada.
 */
function migrarTarjetasFaltantes(conexion: Database.Database) {
  const faltantes = conexion
    .prepare(
      `SELECT DISTINCT r.tipo_tarjeta, s.ultimos_4, s.titular
       FROM subtotales s JOIN resumenes r ON r.id = s.resumen_id
       WHERE NOT EXISTS (SELECT 1 FROM tarjetas t
                         WHERE t.tipo_tarjeta = r.tipo_tarjeta AND t.ultimos_4 = s.ultimos_4)`,
    )
    .all() as { tipo_tarjeta: string; ultimos_4: string; titular: string }[];
  if (faltantes.length === 0) return;

  const personas = conexion.prepare("SELECT id, nombre FROM personas").all() as { id: number; nombre: string }[];
  conexion.transaction(() => {
    for (const t of faltantes) {
      const duenio = personas.find((p) => mismoNombre(t.titular, p.nombre))?.id ?? null;
      conexion
        .prepare("INSERT OR IGNORE INTO tarjetas (tipo_tarjeta, ultimos_4, titular, persona_id) VALUES (?, ?, ?, ?)")
        .run(t.tipo_tarjeta, t.ultimos_4, t.titular, duenio);
      if (duenio === null) continue;
      conexion
        .prepare(
          `INSERT INTO asignaciones (gasto_id, persona_id, centavos)
           SELECT g.id, ?, CAST(ROUND(g.monto * 100) AS INTEGER)
           FROM gastos g JOIN resumenes r ON r.id = g.resumen_id
           WHERE r.tipo_tarjeta = ? AND g.ultimos_4 = ?
             AND NOT EXISTS (SELECT 1 FROM asignaciones a WHERE a.gasto_id = g.id)`,
        )
        .run(duenio, t.tipo_tarjeta, t.ultimos_4);
    }
  })();
}

/** Solo para tests: cierra la conexión para poder abrir otra base. */
export function cerrarDb() {
  global.__db?.close();
  global.__db = undefined;
}

// --- Conversión centavos (cálculos) ↔ pesos (columnas REAL de la Fase 1) ---
export const aPesos = (centavos: number) => centavos / 100;
export const aCentavos = (pesos: number) => Math.round(pesos * 100);
