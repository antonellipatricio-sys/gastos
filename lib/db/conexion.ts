// Conexión a MongoDB (Atlas en la nube, o el que indique MONGODB_URI).
//
// MongoDB guarda "documentos" (objetos tipo JSON) en "colecciones" (parecido a tablas).
// Aprovechamos eso para guardar junto lo que va junto: por ejemplo, cada gasto lleva adentro
// su reparto entre personas (`partes`), y cada resumen lleva sus subtotales e impuestos.
import { MongoClient, type ClientSession, type Collection, type Db } from "mongodb";
import type { Moneda } from "../parser/montos";
import type { Parte } from "../reparto";
import type { CriterioImpuestos, ImpuestoManual, LineaImpuesto, Totales } from "../saldos";

// ---------------------------------------------------------------------------
// Cómo es cada documento
// ---------------------------------------------------------------------------

export interface PersonaDoc {
  _id: number;
  nombre: string;
  esYo: boolean;
}

/** Cada tarjeta física (tipo + últimos 4) y a quién se le asignan sus gastos por defecto. */
export interface TarjetaDoc {
  tipo: string;
  ultimos4: string;
  titular: string;
  personaId: number | null;
}

export interface ResumenDoc {
  _id: number;
  tipo: string; // 'VISA' | 'AMEX'
  periodo: string;
  cierre: string; // ISO '2026-08-27'
  vencimiento: string;
  totalImpuestos: Totales; // en centavos
  totalPagos: Totales;
  saldoAnterior: Totales | null; // lo que dice el banco
  totalAPagar: Totales | null;
  criterioImpuestos: CriterioImpuestos;
  /** Lo que dice el banco en "Subtotal de X", por tarjeta, en el orden del resumen. */
  subtotales: { ultimos4: string; titular: string; banco: Totales | null }[];
  impuestosLineas: LineaImpuesto[];
  impuestosManual: ImpuestoManual[];
  importadoEn: Date;
}

export interface GastoDoc {
  _id: number;
  resumenId: number;
  tipo: string; // copiado del resumen, para buscar cuotas anteriores sin cruzar colecciones
  cierre: string; // ídem
  titular: string;
  ultimos4: string;
  fecha: string;
  descripcion: string;
  cuotaActual: number | null;
  cuotasTotales: number | null;
  comprobante: string | null;
  moneda: Moneda;
  centavos: number;
  /** Quién paga el gasto: vacío = sin asignar; varias partes = dividido. Suman `centavos`. */
  partes: Parte[];
}

export interface PagoDoc {
  _id: number;
  personaId: number;
  fecha: string;
  moneda: Moneda; // la deuda que cancela
  centavos: number;
  pagadoEnPesos: number | null; // si pagó dólares con pesos: cuántos pesos dio
  tipoCambio: number | null;
  nota: string | null;
  creadoEn: Date;
}

interface ContadorDoc {
  _id: string;
  valor: number;
}

export interface Colecciones {
  personas: Collection<PersonaDoc>;
  tarjetas: Collection<TarjetaDoc>;
  resumenes: Collection<ResumenDoc>;
  gastos: Collection<GastoDoc>;
  pagos: Collection<PagoDoc>;
  contadores: Collection<ContadorDoc>;
}

// Las personas que se cargan la primera vez (después se pueden editar desde la app).
const PERSONAS_INICIALES: { nombre: string; esYo: boolean }[] = [
  { nombre: "Patricio", esYo: true },
  { nombre: "Mariana", esYo: false },
  { nombre: "Micaela", esYo: false },
  { nombre: "Brenda", esYo: false },
  { nombre: "Banay", esYo: false },
];

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

interface Conexion {
  cliente: MongoClient;
  db: Db;
  col: Colecciones;
}

// Guardamos la conexión en globalThis: en Vercel (y en desarrollo, donde Next recarga los
// módulos seguido) así se reusa la misma en vez de abrir una nueva en cada visita.
const global = globalThis as unknown as { __mongo?: Promise<Conexion> };

function conexion(): Promise<Conexion> {
  global.__mongo ??= abrir().catch((e) => {
    global.__mongo = undefined; // si falló (ej. sin internet), que el próximo intento vuelva a probar
    throw e;
  });
  return global.__mongo;
}

/** Las colecciones, listas para usar. */
export async function colecciones(): Promise<Colecciones> {
  return (await conexion()).col;
}

async function abrir(): Promise<Conexion> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Falta configurar MONGODB_URI (la dirección de tu base en MongoDB Atlas). " +
        "En tu compu va en el archivo .env.local; publicada, en las variables de entorno de Vercel. Ver el README.",
    );
  }
  const cliente = new MongoClient(uri);
  await cliente.connect();
  const db = cliente.db(process.env.MONGODB_DB || "gastos");
  const col: Colecciones = {
    personas: db.collection("personas"),
    tarjetas: db.collection("tarjetas"),
    resumenes: db.collection("resumenes"),
    gastos: db.collection("gastos"),
    pagos: db.collection("pagos"),
    contadores: db.collection("contadores"),
  };
  await prepararIndices(col);
  await cargarPersonasIniciales(col);
  return { cliente, db, col };
}

/**
 * Índices: hacen rápidas las búsquedas y, los "unique", impiden duplicados.
 * createIndex no hace nada si el índice ya existe, así que se puede correr siempre.
 */
async function prepararIndices(col: Colecciones) {
  // Un mismo resumen no se puede importar dos veces (mismo tipo de tarjeta + misma fecha de cierre).
  await col.resumenes.createIndex({ tipo: 1, cierre: 1 }, { unique: true });
  await col.tarjetas.createIndex({ tipo: 1, ultimos4: 1 }, { unique: true });
  // Nombres de personas únicos sin distinguir mayúsculas ni tildes ("micaela" = "Micaela").
  await col.personas.createIndex({ nombre: 1 }, { unique: true, collation: { locale: "es", strength: 1 } });
  await col.gastos.createIndex({ resumenId: 1 });
  await col.gastos.createIndex({ "partes.personaId": 1 });
  await col.gastos.createIndex({ tipo: 1, ultimos4: 1, descripcion: 1, cuotasTotales: 1, cuotaActual: 1 });
  await col.pagos.createIndex({ personaId: 1, fecha: 1 });
}

async function cargarPersonasIniciales(col: Colecciones) {
  if ((await col.personas.estimatedDocumentCount()) > 0) return;
  const primerId = await siguientesIds(col, "personas", PERSONAS_INICIALES.length);
  try {
    await col.personas.insertMany(
      PERSONAS_INICIALES.map((p, i) => ({ _id: primerId + i, nombre: p.nombre, esYo: p.esYo })),
    );
  } catch (e) {
    // Si otra visita las cargó al mismo tiempo, el índice único lo frena: no pasa nada.
    if (!esDuplicado(e)) throw e;
  }
}

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

/**
 * Reserva `cantidad` ids numéricos seguidos para una colección y devuelve el primero.
 * Usamos números (1, 2, 3…) en vez de los ids largos de Mongo para que los links de la app
 * sigan siendo cortos (/resumenes/3, /personas/5).
 */
export async function siguientesIds(
  col: Colecciones,
  nombre: string,
  cantidad = 1,
  session?: ClientSession,
): Promise<number> {
  const r = await col.contadores.findOneAndUpdate(
    { _id: nombre },
    { $inc: { valor: cantidad } },
    { upsert: true, returnDocument: "after", session },
  );
  return r!.valor - cantidad + 1;
}

/** Corre varias operaciones como una sola: si alguna falla, no se guarda ninguna. */
export async function enTransaccion<T>(fn: (session: ClientSession, col: Colecciones) => Promise<T>): Promise<T> {
  const { cliente, col } = await conexion();
  const session = cliente.startSession();
  try {
    let resultado: T;
    await session.withTransaction(async () => {
      resultado = await fn(session, col);
    });
    return resultado!;
  } finally {
    await session.endSession();
  }
}

/** ¿El error es "ya existe un documento con esa clave única"? */
export function esDuplicado(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}

/** Solo para tests: cierra la conexión para poder abrir otra base. */
export async function cerrarDb() {
  const abierta = global.__mongo;
  global.__mongo = undefined;
  await (await abierta)?.cliente.close();
}

// --- Conversión centavos ↔ pesos (algunas pantallas muestran montos en pesos) ---
export const aPesos = (centavos: number) => centavos / 100;
export const aCentavos = (pesos: number) => Math.round(pesos * 100);
