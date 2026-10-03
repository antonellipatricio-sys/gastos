// Importar y leer resúmenes.
import type { Resumen, Totales } from "../parser/santander";
import type { DatosValidacion } from "../parser/validar";
import { mismoNombre, type Parte } from "../reparto";
import type { CriterioImpuestos, ImpuestoManual } from "../saldos";
import { repartoAutomatico } from "./asignaciones";
import {
  aPesos,
  colecciones,
  enTransaccion,
  esDuplicado,
  siguientesIds,
  type GastoDoc,
  type ResumenDoc,
} from "./conexion";

// Las pantallas reciben los datos con estos nombres (vienen de la primera versión de la app,
// con SQLite). Los mantenemos para no tener que cambiar ninguna pantalla.

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
  monto: number; // en pesos (o dólares), no en centavos
}

function aFilaResumen(r: ResumenDoc): FilaResumen {
  return {
    id: r._id,
    tipo_tarjeta: r.tipo,
    periodo: r.periodo,
    cierre: r.cierre,
    vencimiento: r.vencimiento,
    total_impuestos_pesos: aPesos(r.totalImpuestos.ARS),
    total_impuestos_dolares: aPesos(r.totalImpuestos.USD),
    total_pagos_pesos: aPesos(r.totalPagos.ARS),
    total_pagos_dolares: aPesos(r.totalPagos.USD),
    saldo_anterior_pesos: r.saldoAnterior ? aPesos(r.saldoAnterior.ARS) : null,
    saldo_anterior_dolares: r.saldoAnterior ? aPesos(r.saldoAnterior.USD) : null,
    total_a_pagar_pesos: r.totalAPagar ? aPesos(r.totalAPagar.ARS) : null,
    total_a_pagar_dolares: r.totalAPagar ? aPesos(r.totalAPagar.USD) : null,
    criterio_impuestos: r.criterioImpuestos,
  };
}

function aFilaGasto(g: GastoDoc): FilaGasto {
  return {
    id: g._id,
    titular: g.titular,
    ultimos_4: g.ultimos4,
    fecha: g.fecha,
    descripcion: g.descripcion,
    cuota_actual: g.cuotaActual,
    cuotas_totales: g.cuotasTotales,
    comprobante: g.comprobante,
    moneda: g.moneda,
    monto: aPesos(g.centavos),
  };
}

export async function buscarResumen(tipo: string, cierre: string): Promise<{ id: number } | undefined> {
  const r = await (await colecciones()).resumenes.findOne({ tipo, cierre }, { projection: { _id: 1 } });
  return r ? { id: r._id } : undefined;
}

/**
 * Guarda el resumen, sus gastos y el reparto automático en UNA transacción:
 * o se guarda todo, o nada.
 */
export async function guardarResumen(r: Resumen): Promise<number> {
  try {
    return await enTransaccion(async (session, col) => {
      const resumenId = await siguientesIds(col, "resumenes", 1, session);
      await col.resumenes.insertOne(
        {
          _id: resumenId,
          tipo: r.tipo,
          periodo: r.periodo,
          cierre: r.cierre,
          vencimiento: r.vencimiento,
          totalImpuestos: r.totalImpuestos,
          totalPagos: r.totalPagos,
          saldoAnterior: r.saldoAnteriorBanco,
          totalAPagar: r.totalAPagarBanco,
          criterioImpuestos: "proporcional",
          subtotales: r.tarjetas.map((t) => ({ ultimos4: t.ultimos4, titular: t.titular, banco: t.subtotalBanco })),
          impuestosLineas: r.impuestos,
          impuestosManual: [],
          importadoEn: new Date(),
        },
        { session },
      );

      const personas = await col.personas.find({}, { session }).toArray();
      const totalGastos = r.tarjetas.reduce((n, t) => n + t.gastos.length, 0);
      let siguienteGasto = totalGastos > 0 ? await siguientesIds(col, "gastos", totalGastos, session) : 0;
      const gastos: GastoDoc[] = [];

      for (const t of r.tarjetas) {
        // Primera vez que vemos esta tarjeta: la registramos y sugerimos dueño por el nombre del titular.
        const tarjeta = await col.tarjetas.findOne({ tipo: r.tipo, ultimos4: t.ultimos4 }, { session });
        let duenio = tarjeta?.personaId ?? null;
        if (!tarjeta) {
          duenio = personas.find((p) => mismoNombre(t.titular, p.nombre))?._id ?? null;
          await col.tarjetas.insertOne(
            { tipo: r.tipo, ultimos4: t.ultimos4, titular: t.titular, personaId: duenio },
            { session },
          );
        }

        for (const g of t.gastos) {
          const partes = await repartoAutomatico(
            col,
            {
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
            duenio,
            session,
          );
          gastos.push({
            _id: siguienteGasto++,
            resumenId,
            tipo: r.tipo,
            cierre: r.cierre,
            titular: t.titular,
            ultimos4: t.ultimos4,
            fecha: g.fecha,
            descripcion: g.descripcion,
            cuotaActual: g.cuotaActual,
            cuotasTotales: g.cuotasTotales,
            comprobante: g.comprobante,
            moneda: g.moneda,
            centavos: g.centavos,
            partes,
          });
        }
      }
      if (gastos.length) await col.gastos.insertMany(gastos, { session });
      return resumenId;
    });
  } catch (e) {
    if (esDuplicado(e)) throw new Error(`Este resumen ${r.tipo} con cierre ${r.cierre} ya estaba importado.`);
    throw e;
  }
}

export async function listarResumenes(): Promise<(FilaResumen & { cantidad_gastos: number; sin_asignar: number })[]> {
  const col = await colecciones();
  const [resumenes, conteos] = await Promise.all([
    col.resumenes.find().sort({ cierre: -1, tipo: 1 }).toArray(),
    col.gastos
      .aggregate<{ _id: number; total: number; sinAsignar: number }>([
        {
          $group: {
            _id: "$resumenId",
            total: { $sum: 1 },
            sinAsignar: { $sum: { $cond: [{ $eq: [{ $size: "$partes" }, 0] }, 1, 0] } },
          },
        },
      ])
      .toArray(),
  ]);
  return resumenes.map((r) => {
    const c = conteos.find((x) => x._id === r._id);
    return { ...aFilaResumen(r), cantidad_gastos: c?.total ?? 0, sin_asignar: c?.sinAsignar ?? 0 };
  });
}

export type GastoConPartes = FilaGasto & { partes: Parte[] };

export async function obtenerResumen(id: number) {
  const col = await colecciones();
  const doc = await col.resumenes.findOne({ _id: id });
  if (!doc) return null;
  const docsGastos = await col.gastos.find({ resumenId: id }).sort({ _id: 1 }).toArray();
  const gastos: GastoConPartes[] = docsGastos.map((g) => ({ ...aFilaGasto(g), partes: g.partes }));

  // Agrupamos por tarjeta (titular + últimos 4), respetando el orden del resumen.
  const tarjetas = doc.subtotales.map((s) => {
    const suyos = gastos.filter((g) => g.ultimos_4 === s.ultimos4);
    const suma = { ARS: 0, USD: 0 };
    for (const g of docsGastos) if (g.ultimos4 === s.ultimos4) suma[g.moneda] += g.centavos;
    return { titular: s.titular, ultimos4: s.ultimos4, gastos: suyos, suma, subtotalBanco: s.banco };
  });

  // Totales por persona en este resumen (y lo que quedó sin asignar).
  const porPersona = new Map<number, Totales>();
  const sinAsignar: Totales = { ARS: 0, USD: 0 };
  for (const g of docsGastos) {
    if (g.partes.length === 0) sinAsignar[g.moneda] += g.centavos;
    for (const p of g.partes) {
      const t = porPersona.get(p.personaId) ?? { ARS: 0, USD: 0 };
      t[g.moneda] += p.centavos;
      porPersona.set(p.personaId, t);
    }
  }

  const validacion: DatosValidacion = {
    tarjetas,
    totalPagos: doc.totalPagos,
    saldoAnteriorBanco: doc.saldoAnterior,
    totalImpuestos: doc.totalImpuestos,
    totalAPagarBanco: doc.totalAPagar,
  };
  return { resumen: aFilaResumen(doc), tarjetas, validacion, porPersona, sinAsignar };
}

/** Borra un resumen con todo lo suyo (gastos y repartos), por ejemplo para reimportarlo. */
export async function borrarResumen(id: number): Promise<void> {
  await enTransaccion(async (session, col) => {
    await col.gastos.deleteMany({ resumenId: id }, { session });
    await col.resumenes.deleteOne({ _id: id }, { session });
  });
}

export async function cambiarCriterioImpuestos(id: number, criterio: CriterioImpuestos): Promise<void> {
  await (await colecciones()).resumenes.updateOne({ _id: id }, { $set: { criterioImpuestos: criterio } });
}

/**
 * Guarda el reparto manual de impuestos y pasa el resumen a criterio 'manual'.
 * Por cada moneda, las partes tienen que sumar exactamente el total de impuestos del resumen.
 */
export async function guardarImpuestosManual(id: number, partes: ImpuestoManual[]): Promise<void> {
  const col = await colecciones();
  const r = await col.resumenes.findOne({ _id: id }, { projection: { totalImpuestos: 1 } });
  if (!r) throw new Error("El resumen no existe.");
  for (const moneda of ["ARS", "USD"] as const) {
    const suma = partes.filter((p) => p.moneda === moneda).reduce((s, p) => s + p.centavos, 0);
    if (suma !== r.totalImpuestos[moneda]) {
      const f = (c: number) => (c / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 });
      throw new Error(
        `Los impuestos en ${moneda === "ARS" ? "pesos" : "dólares"} suman ${f(suma)} y deberían sumar ${f(r.totalImpuestos[moneda])}.`,
      );
    }
  }
  const ids = [...new Set(partes.map((p) => p.personaId))];
  if ((await col.personas.countDocuments({ _id: { $in: ids } })) !== ids.length) {
    throw new Error("Alguna de las personas no existe.");
  }
  await col.resumenes.updateOne(
    { _id: id },
    {
      $set: {
        impuestosManual: partes
          .filter((p) => p.centavos !== 0)
          .map((p) => ({ personaId: p.personaId, moneda: p.moneda, centavos: p.centavos })),
        criterioImpuestos: "manual",
      },
    },
  );
}
