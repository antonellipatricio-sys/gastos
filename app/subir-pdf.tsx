"use client";
// Componente de cliente (corre en el navegador): necesita estado para mostrar
// "Procesando..." y los mensajes de error que devuelve la Server Action.

import Link from "next/link";
import { useActionState } from "react";
import { importarResumen, type EstadoImportacion } from "./actions";

const INICIAL: EstadoImportacion = { tipo: "inicial" };

export function SubirPdf() {
  const [estado, accion, procesando] = useActionState(importarResumen, INICIAL);

  return (
    <form action={accion} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <label className="block text-sm font-medium" htmlFor="pdf">
        Resumen de tarjeta (PDF de Santander, Visa o American Express)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="pdf"
          name="pdf"
          type="file"
          accept="application/pdf"
          required
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
        />
        <button
          type="submit"
          disabled={procesando}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {procesando ? "Procesando…" : "Importar"}
        </button>
      </div>

      {estado.tipo === "error" && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-800">✘ {estado.mensaje}</p>
      )}
      {estado.tipo === "duplicado" && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          ⚠ {estado.mensaje}{" "}
          <Link href={`/resumenes/${estado.resumenId}`} className="underline">
            Ver resumen
          </Link>
        </p>
      )}
    </form>
  );
}
