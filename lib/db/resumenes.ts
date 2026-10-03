// Importar y leer resúmenes.
import type { Resumen, Totales } from "../parser/santander";
import type { DatosValidacion } from "../parser/validar";
import { mismoNombre, type Parte } from "../reparto";
import type { CriterioImpuestos, ImpuestoManual } from "../saldos";
import { guardarPartes, partesDeResumen, repartoAutomatico } from "./asignaciones";
import { aCentavos, aPesos, db } from "./conexion";

// Todas las funciones de acceso a datos son async aunque better-sqlite3 sea sincrónico:
// el día que la app se publique con una base en la nube (Postgres, Turso), las consultas
// van a ser asincrónicas y así las pantallas no hay que tocarlas.

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
  criterio_impuestos: CriterioImpuestos;
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

/**
 * Guarda el resumen, sus gastos y el reparto automático en UNA transacción:
 * o se guarda todo, o nada.
 */
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
    const personas = conexion.prepare("SELECT id, nombre FROM personas").all() as { id: number; nombre: string }[];

    const insertarImpuesto = conexion.prepare(
      "INSERT INTO impuestos_lineas (resumen_id, descripcion, moneda, centavos) VALUES (?, ?, ?, ?)",
    );
    for (const i of r.impuestos) insertarImpuesto.run(resumenId, i.descripcion, i.moneda, i.centavos);

    for (const t of r.tarjetas) {
      insertarSubtotal.run(
        resumenId, t.ultimos4, t.titular,
        t.subtotalBanco ? aPesos(t.subtotalBanco.ARS) : null,
        t.subtotalBanco ? aPesos(t.subtotalBanco.USD) : null,
      );

      // Primera vez que vemos esta tarjeta: la registramos y sugerimos dueño por el nombre del titular.
      let tarjeta = conexion
        .prepare("SELECT persona_id FROM tarjetas WHERE tipo_tarjeta = ? AND ultimos_4 = ?")
        .get(r.tipo, t.ultimos4) as { persona_id: number | null } | undefined;
      if (!tarjeta) {
        const sugerida = personas.find((p) => mismoNombre(t.titular, p.nombre))?.id ?? null;
        conexion
          .prepare("INSERT INTO tarjetas (tipo_tarjeta, ultimos_4, titular, persona_id) VALUES (?, ?, ?, ?)")
          .run(r.tipo, t.ultimos4, t.titular, sugerida);
        tarjeta = { persona_id: sugerida };
      }

      for (const g of t.gastos) {
        const { lastInsertRowid: gastoId } = insertarGasto.run(
          resumenId, t.titular, t.ultimos4, g.fecha, g.descripcion, g.cuotaActual,
          g.cuotasTotales, g.comprobante, g.moneda, aPesos(g.centavos),
        );
        const partes = repartoAutomatico(
          conexion,
          {
            id: Number(gastoId),
            tipoTarjeta: r.tipo,
            cierre: r.cierre,
            ultimos4: t.ultimos4,
            descripcion: g.descripcion,
            cuotaActual: g.cuotaActual,
            cuotasTotales: g.cuotasTotales,
            comprobante: g.comprobante,
            moneda: g.moneda,
            centavos: g.centavos,
          },
          tarjeta.persona_id,
        );
        guardarPartes(conexion, Number(gastoId), partes);
      }
    }
    return resumenId;
  });
  return guardar();
}

export async function listarResumenes(): Promise<(FilaResumen & { cantidad_gastos: number; sin_asignar: number })[]> {
  return db()
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM gastos g WHERE g.resumen_id = r.id) AS cantidad_gastos,
         (SELECT COUNT(*) FROM gastos g WHERE g.resumen_id = r.id
            AND NOT EXISTS (SELECT 1 FROM asignaciones a WHERE a.gasto_id = g.id)) AS sin_asignar
       FROM resumenes r ORDER BY r.cierre DESC, r.tipo_tarjeta`,
    )
    .all() as (FilaResumen & { cantidad_gastos: number; sin_asignar: number })[];
}

export type GastoConPartes = FilaGasto & { partes: Parte[] };

export async function obtenerResumen(id: number) {
  const resumen = db().prepare("SELECT * FROM resumenes WHERE id = ?").get(id) as FilaResumen | undefined;
  if (!resumen) return null;
  const partes = partesDeResumen(id);
  const gastos: GastoConPartes[] = (
    db().prepare("SELECT * FROM gastos WHERE resumen_id = ? ORDER BY id").all(id) as FilaGasto[]
  ).map((g) => ({ ...g, partes: partes.get(g.id) ?? [] }));
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

  // Totales por persona en este resumen (y lo que quedó sin asignar).
  const porPersona = new Map<number, Totales>();
  const sinAsignar: Totales = { ARS: 0, USD: 0 };
  for (const g of gastos) {
    if (g.partes.length === 0) sinAsignar[g.moneda] += aCentavos(g.monto);
    for (const p of g.partes) {
      const t = porPersona.get(p.personaId) ?? { ARS: 0, USD: 0 };
      t[g.moneda] += p.centavos;
      porPersona.set(p.personaId, t);
    }
  }

  const validacion: DatosValidacion = {
    tarjetas,
    totalPagos: { ARS: aCentavos(resumen.total_pagos_pesos), USD: aCentavos(resumen.total_pagos_dolares) },
    saldoAnteriorBanco: totalesDe(resumen.saldo_anterior_pesos, resumen.saldo_anterior_dolares),
    totalImpuestos: { ARS: aCentavos(resumen.total_impuestos_pesos), USD: aCentavos(resumen.total_impuestos_dolares) },
    totalAPagarBanco: totalesDe(resumen.total_a_pagar_pesos, resumen.total_a_pagar_dolares),
  };
  return { resumen, tarjetas, validacion, porPersona, sinAsignar };
}

/** Borra un resumen con todo lo suyo (gastos, repartos, impuestos), por ejemplo para reimportarlo. */
export async function borrarResumen(id: number): Promise<void> {
  db().prepare("DELETE FROM resumenes WHERE id = ?").run(id);
}

export async function cambiarCriterioImpuestos(id: number, criterio: CriterioImpuestos): Promise<void> {
  db().prepare("UPDATE resumenes SET criterio_impuestos = ? WHERE id = ?").run(criterio, id);
}

/**
 * Guarda el reparto manual de impuestos y pasa el resumen a criterio 'manual'.
 * Por cada moneda, las partes tienen que sumar exactamente el total de impuestos del resumen.
 */
export async function guardarImpuestosManual(id: number, partes: ImpuestoManual[]): Promise<void> {
  const conexion = db();
  const r = conexion
    .prepare("SELECT total_impuestos_pesos, total_impuestos_dolares FROM resumenes WHERE id = ?")
    .get(id) as { total_impuestos_pesos: number; total_impuestos_dolares: number } | undefined;
  if (!r) throw new Error("El resumen no existe.");
  const total = { ARS: aCentavos(r.total_impuestos_pesos), USD: aCentavos(r.total_impuestos_dolares) };
  for (const moneda of ["ARS", "USD"] as const) {
    const suma = partes.filter((p) => p.moneda === moneda).reduce((s, p) => s + p.centavos, 0);
    if (suma !== total[moneda]) {
      const f = (c: number) => (c / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 });
      throw new Error(`Los impuestos en ${moneda === "ARS" ? "pesos" : "dólares"} suman ${f(suma)} y deberían sumar ${f(total[moneda])}.`);
    }
  }
  conexion.transaction(() => {
    conexion.prepare("DELETE FROM impuestos_manual WHERE resumen_id = ?").run(id);
    const insertar = conexion.prepare(
      "INSERT INTO impuestos_manual (resumen_id, persona_id, moneda, centavos) VALUES (?, ?, ?, ?)",
    );
    for (const p of partes) if (p.centavos !== 0) insertar.run(id, p.personaId, p.moneda, p.centavos);
    conexion.prepare("UPDATE resumenes SET criterio_impuestos = 'manual' WHERE id = ?").run(id);
  })();
}
