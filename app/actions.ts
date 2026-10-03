"use server";
// Server Action: este código corre en el servidor (tu compu), no en el navegador.
// Por eso puede leer el PDF con pdf-parse y escribir en SQLite.

import { redirect } from "next/navigation";
import { buscarResumen, guardarResumen } from "@/lib/db";
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
