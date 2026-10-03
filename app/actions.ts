"use server";
// Server Action: este código corre en el servidor (tu compu), no en el navegador.
// Por eso puede leer el PDF con pdf-parse y escribir en SQLite.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  asignarDuenioTarjeta,
  asignarGasto,
  borrarPago,
  borrarResumen,
  buscarResumen,
  cambiarCriterioImpuestos,
  crearPersona,
  eliminarPersona,
  guardarImpuestosManual,
  guardarResumen,
  registrarPago,
  renombrarPersona,
} from "@/lib/db";
import type { Parte } from "@/lib/reparto";
import type { CriterioImpuestos, ImpuestoManual } from "@/lib/saldos";
import { extraerTexto } from "@/lib/pdf";
import { parsearResumen } from "@/lib/parser/santander";
import {
  COOKIE_SESION,
  crearToken,
  DURACION_SESION_SEGUNDOS,
  estadoAcceso,
  passwordCorrecta,
} from "@/lib/sesion";

// ===== Sesión =====
// Cada acción (salvo iniciar sesión) llama a exigirSesion() antes de hacer nada: aunque el
// proxy ya bloquea las visitas sin sesión, es una segunda barrera por si algo se le escapa.

async function exigirSesion() {
  const estado = estadoAcceso((await cookies()).get(COOKIE_SESION)?.value);
  if (estado !== "ok" && estado !== "libre") redirect("/login");
}

export async function iniciarSesionAccion(_estado: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const intento = String(formData.get("password") ?? "");
  if (!passwordCorrecta(intento)) {
    // Una pequeña espera en cada intento fallido hace muy lento probar contraseñas al azar.
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "Contraseña incorrecta." };
  }
  (await cookies()).set(COOKIE_SESION, crearToken(), {
    httpOnly: true, // el JavaScript de la página no la puede leer
    secure: process.env.NODE_ENV === "production", // solo viaja por https
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_SESION_SEGUNDOS,
  });
  redirect("/");
}

export async function cerrarSesionAccion() {
  (await cookies()).delete(COOKIE_SESION);
  redirect("/login");
}

export type EstadoImportacion =
  | { tipo: "inicial" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "duplicado"; mensaje: string; resumenId: number };

export async function importarResumen(
  _estadoAnterior: EstadoImportacion,
  formData: FormData,
): Promise<EstadoImportacion> {
  await exigirSesion();
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
  if (texto.includes("FOREIGN KEY")) return "Esa persona tiene gastos o pagos cargados: no se puede borrar.";
  return texto;
}

const esId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

export async function crearPersonaAccion(nombre: string): Promise<Resultado> {
  await exigirSesion();
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
  await exigirSesion();
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
  await exigirSesion();
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
  await exigirSesion();
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
  await exigirSesion();
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

// ===== Fase 3: impuestos, resúmenes y pagos =====

const CRITERIOS: CriterioImpuestos[] = ["proporcional", "yo", "manual"];
const esMoneda = (m: unknown): m is "ARS" | "USD" => m === "ARS" || m === "USD";

export async function cambiarCriterioAccion(resumenId: number, criterio: CriterioImpuestos): Promise<Resultado> {
  await exigirSesion();
  if (!esId(resumenId) || !CRITERIOS.includes(criterio)) return { error: "Datos inválidos." };
  await cambiarCriterioImpuestos(resumenId, criterio);
  revalidatePath("/", "layout");
  return {};
}

export async function guardarImpuestosManualAccion(resumenId: number, partes: ImpuestoManual[]): Promise<Resultado> {
  await exigirSesion();
  if (
    !esId(resumenId) ||
    !Array.isArray(partes) ||
    partes.some((p) => !esId(p.personaId) || !esMoneda(p.moneda) || !Number.isInteger(p.centavos))
  ) {
    return { error: "Datos inválidos." };
  }
  try {
    await guardarImpuestosManual(resumenId, partes);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function borrarResumenAccion(resumenId: number): Promise<Resultado> {
  await exigirSesion();
  if (!esId(resumenId)) return { error: "Resumen inválido." };
  await borrarResumen(resumenId);
  revalidatePath("/", "layout");
  redirect("/");
}

export interface DatosPago {
  personaId: number;
  fecha: string; // ISO
  moneda: "ARS" | "USD";
  centavos: number;
  pagadoEnPesos: number | null;
  tipoCambio: number | null;
  nota: string;
}

export async function registrarPagoAccion(d: DatosPago): Promise<Resultado> {
  await exigirSesion();
  if (!esId(d.personaId) || !esMoneda(d.moneda)) return { error: "Datos inválidos." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return { error: "La fecha no es válida." };
  if (!Number.isInteger(d.centavos) || d.centavos <= 0) return { error: "El monto tiene que ser mayor a cero." };
  const enPesos = d.pagadoEnPesos !== null;
  if (enPesos && (d.moneda !== "USD" || !Number.isInteger(d.pagadoEnPesos) || !(d.tipoCambio! > 0))) {
    return { error: "Para un pago en pesos de una deuda en dólares, indicá los pesos y la cotización." };
  }
  try {
    await registrarPago({
      personaId: d.personaId,
      fecha: d.fecha,
      moneda: d.moneda,
      centavos: d.centavos,
      pagadoEnPesos: enPesos ? d.pagadoEnPesos : null,
      tipoCambio: enPesos ? d.tipoCambio : null,
      nota: d.nota.trim() || null,
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function borrarPagoAccion(pagoId: number): Promise<Resultado> {
  await exigirSesion();
  if (!esId(pagoId)) return { error: "Pago inválido." };
  await borrarPago(pagoId);
  revalidatePath("/", "layout");
  return {};
}
