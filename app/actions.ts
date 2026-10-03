"use server";
// Server Action: este código corre en el servidor (tu compu), no en el navegador.
// Por eso puede leer el PDF con pdf-parse y escribir en SQLite.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  asignarDuenioTarjeta,
  asignarGasto,
  buscarResumen,
  crearPersona,
  eliminarPersona,
  guardarResumen,
  renombrarPersona,
} from "@/lib/db";
import type { Parte } from "@/lib/reparto";
import { extraerTexto } from "@/lib/pdf";
import { parsearResumen } from "@/lib/parser/santander";

export type EstadoImportacion =
  | { tipo: "inicial" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "duplicado"; mensaje: string; resumenId: number };

export async function importarResumen(
  _estadoAnterior: EstadoImportacion,
  formData: FormData,
): Promise<EstadoImportacion> {
  const archivo = formData.get("pdf");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { tipo: "error", mensaje: "Elegí un archivo PDF." };
  }

  let resumenId: number;
  try {
    const texto = await extraerTexto(new Uint8Array(await archivo.arrayBuffer()));
    const resumen = parsearResumen(texto);

    // No importar dos veces el mismo resumen (mismo tipo de tarjeta + misma fecha de cierre).
    const existente = await buscarResumen(resumen.tipo, resumen.cierre);
    if (existente) {
      return {
        tipo: "duplicado",
        mensaje: `Este resumen ${resumen.tipo} con cierre ${resumen.cierre} ya estaba importado.`,
        resumenId: existente.id,
      };
    }
    resumenId = await guardarResumen(resumen);
  } catch (e) {
    return { tipo: "error", mensaje: e instanceof Error ? e.message : String(e) };
  }

  // redirect() va fuera del try: internamente "lanza" una señal que el catch atraparía.
  redirect(`/resumenes/${resumenId}`);
}

// ===== Fase 2: personas y asignaciones =====
// Estas acciones devuelven { error } en vez de lanzar, para que la pantalla muestre el mensaje.

type Resultado = { error?: string };

function mensaje(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  if (texto.includes("UNIQUE")) return "Ya existe una persona con ese nombre.";
  if (texto.includes("FOREIGN KEY")) return "Esa persona tiene gastos asignados: reasignalos antes de borrarla.";
  return texto;
}

const esId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

export async function crearPersonaAccion(nombre: string): Promise<Resultado> {
  const limpio = nombre.trim();
  if (!limpio) return { error: "Escribí un nombre." };
  try {
    await crearPersona(limpio);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function renombrarPersonaAccion(id: number, nombre: string): Promise<Resultado> {
  const limpio = nombre.trim();
  if (!esId(id) || !limpio) return { error: "Escribí un nombre." };
  try {
    await renombrarPersona(id, limpio);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function eliminarPersonaAccion(id: number): Promise<Resultado> {
  if (!esId(id)) return { error: "Persona inválida." };
  try {
    await eliminarPersona(id);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function asignarDuenioAccion(
  tipo: string,
  ultimos4: string,
  personaId: number | null,
): Promise<Resultado & { asignados?: number }> {
  if (personaId !== null && !esId(personaId)) return { error: "Persona inválida." };
  try {
    const asignados = await asignarDuenioTarjeta(tipo, ultimos4, personaId);
    revalidatePath("/", "layout");
    return { asignados };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function asignarGastoAccion(gastoId: number, partes: Parte[]): Promise<Resultado> {
  if (!esId(gastoId) || !Array.isArray(partes) || partes.some((p) => !esId(p.personaId))) {
    return { error: "Datos inválidos." };
  }
  try {
    await asignarGasto(gastoId, partes);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/", "layout");
  return {};
}
