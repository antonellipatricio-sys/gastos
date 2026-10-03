// Copia los datos de la base SQLite local (data/gastos.db, de las versiones anteriores de la app)
// a MongoDB, conservando los ids. Se corre UNA sola vez:
//
//   npm run migrar-a-mongo
//
// Toma MONGODB_URI y MONGODB_DB de .env.local (o de las variables de entorno).
// Si la base de Mongo ya tiene resúmenes, gastos o pagos, no hace nada (para no duplicar).
import { createClient } from "@libsql/client";
import { MongoClient } from "mongodb";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const centavos = (pesos) => Math.round(Number(pesos) * 100);
const totales = (ars, usd) => (ars === null || usd === null ? null : { ARS: centavos(ars), USD: centavos(usd) });

async function filas(sqlite, sql, args = []) {
  const r = await sqlite.execute({ sql, args });
  return r.rows.map((fila) => Object.fromEntries(r.columns.map((c, i) => [c, fila[i]])));
}

/** Lee todo de SQLite y lo arma como documentos de Mongo. */
export async function leerSqlite(archivo) {
  const sqlite = createClient({ url: `file:${archivo}` });
  try {
    const tablas = new Set((await filas(sqlite, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name));
    const de = (tabla, sql) => (tablas.has(tabla) ? filas(sqlite, sql) : Promise.resolve([]));

    const personas = (await de("personas", "SELECT * FROM personas ORDER BY id")).map((p) => ({
      _id: Number(p.id),
      nombre: p.nombre,
      esYo: Number(p.es_yo) === 1,
    }));
    const tarjetas = (await de("tarjetas", "SELECT * FROM tarjetas")).map((t) => ({
      tipo: t.tipo_tarjeta,
      ultimos4: t.ultimos_4,
      titular: t.titular,
      personaId: t.persona_id === null ? null : Number(t.persona_id),
    }));

    const subtotales = await de("subtotales", "SELECT * FROM subtotales ORDER BY rowid");
    const lineas = await de("impuestos_lineas", "SELECT * FROM impuestos_lineas ORDER BY rowid");
    const manual = await de("impuestos_manual", "SELECT * FROM impuestos_manual");
    const resumenesSql = await de("resumenes", "SELECT * FROM resumenes ORDER BY id");
    const resumenes = resumenesSql.map((r) => ({
      _id: Number(r.id),
      tipo: r.tipo_tarjeta,
      periodo: r.periodo,
      cierre: r.cierre,
      vencimiento: r.vencimiento,
      totalImpuestos: { ARS: centavos(r.total_impuestos_pesos), USD: centavos(r.total_impuestos_dolares) },
      totalPagos: { ARS: centavos(r.total_pagos_pesos ?? 0), USD: centavos(r.total_pagos_dolares ?? 0) },
      saldoAnterior: totales(r.saldo_anterior_pesos ?? null, r.saldo_anterior_dolares ?? null),
      totalAPagar: totales(r.total_a_pagar_pesos ?? null, r.total_a_pagar_dolares ?? null),
      criterioImpuestos: r.criterio_impuestos ?? "proporcional",
      subtotales: subtotales
        .filter((s) => Number(s.resumen_id) === Number(r.id))
        .map((s) => ({ ultimos4: s.ultimos_4, titular: s.titular, banco: totales(s.pesos, s.dolares) })),
      impuestosLineas: lineas
        .filter((l) => Number(l.resumen_id) === Number(r.id))
        .map((l) => ({ descripcion: l.descripcion, moneda: l.moneda, centavos: Number(l.centavos) })),
      impuestosManual: manual
        .filter((m) => Number(m.resumen_id) === Number(r.id))
        .map((m) => ({ personaId: Number(m.persona_id), moneda: m.moneda, centavos: Number(m.centavos) })),
      importadoEn: r.importado_en ? new Date(`${r.importado_en}Z`) : new Date(),
    }));
    const porId = new Map(resumenes.map((r) => [r._id, r]));

    const asignaciones = await de("asignaciones", "SELECT * FROM asignaciones ORDER BY rowid");
    const gastos = (await de("gastos", "SELECT * FROM gastos ORDER BY id")).map((g) => {
      const r = porId.get(Number(g.resumen_id));
      return {
        _id: Number(g.id),
        resumenId: Number(g.resumen_id),
        tipo: r.tipo,
        cierre: r.cierre,
        titular: g.titular,
        ultimos4: g.ultimos_4,
        fecha: g.fecha,
        descripcion: g.descripcion,
        cuotaActual: g.cuota_actual === null ? null : Number(g.cuota_actual),
        cuotasTotales: g.cuotas_totales === null ? null : Number(g.cuotas_totales),
        comprobante: g.comprobante,
        moneda: g.moneda,
        centavos: centavos(g.monto),
        partes: asignaciones
          .filter((a) => Number(a.gasto_id) === Number(g.id))
          .map((a) => ({ personaId: Number(a.persona_id), centavos: Number(a.centavos) })),
      };
    });

    const pagos = (await de("pagos", "SELECT * FROM pagos ORDER BY id")).map((p) => ({
      _id: Number(p.id),
      personaId: Number(p.persona_id),
      fecha: p.fecha,
      moneda: p.moneda,
      centavos: Number(p.centavos),
      pagadoEnPesos: p.pagado_en_pesos_centavos === null ? null : Number(p.pagado_en_pesos_centavos),
      tipoCambio: p.tipo_cambio === null ? null : Number(p.tipo_cambio),
      nota: p.nota,
      creadoEn: p.creado_en ? new Date(`${p.creado_en}Z`) : new Date(),
    }));

    return { personas, tarjetas, resumenes, gastos, pagos };
  } finally {
    sqlite.close();
  }
}

/** Copia los datos a Mongo en una transacción. Devuelve cuántos documentos copió de cada tipo. */
export async function migrar({ archivo, mongoUri, base }) {
  const datos = await leerSqlite(archivo);
  const cliente = new MongoClient(mongoUri);
  await cliente.connect();
  try {
    const db = cliente.db(base);
    for (const nombre of ["resumenes", "gastos", "pagos"]) {
      if ((await db.collection(nombre).countDocuments()) > 0) {
        throw new Error(`La base "${base}" ya tiene ${nombre}: no migro para no duplicar datos.`);
      }
    }
    const maxId = (docs) => docs.reduce((m, d) => Math.max(m, d._id), 0);
    const session = cliente.startSession();
    try {
      await session.withTransaction(async () => {
        // Las personas y tarjetas que la app crea sola al arrancar se reemplazan por las tuyas.
        for (const nombre of ["personas", "tarjetas", "contadores"]) {
          await db.collection(nombre).deleteMany({}, { session });
        }
        for (const [nombre, docs] of Object.entries(datos)) {
          if (docs.length) await db.collection(nombre).insertMany(docs, { session });
        }
        const contadores = ["personas", "resumenes", "gastos", "pagos"].map((n) => ({ _id: n, valor: maxId(datos[n]) }));
        await db.collection("contadores").insertMany(contadores, { session });
      });
    } finally {
      await session.endSession();
    }
    return Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, v.length]));
  } finally {
    await cliente.close();
  }
}

// --- Cuando se corre como comando ---
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archivo = "data/gastos.db";
  const mongoUri = process.env.MONGODB_URI;
  const base = process.env.MONGODB_DB || "gastos";
  if (!mongoUri) {
    console.error("Falta MONGODB_URI. Ponelo en el archivo .env.local (ver .env.example).");
    process.exit(1);
  }
  if (!fs.existsSync(archivo)) {
    console.error(`No encontré ${archivo}: no hay datos locales para migrar.`);
    process.exit(1);
  }
  try {
    const copiados = await migrar({ archivo, mongoUri, base });
    console.log(`Listo, copié a la base "${base}":`, copiados);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
