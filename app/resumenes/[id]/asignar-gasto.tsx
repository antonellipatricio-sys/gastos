"use client";
// Celda "De quién" de cada gasto: elegir una persona, dejarlo sin asignar o dividirlo.

import { useState, useTransition } from "react";
import { EditorReparto } from "@/app/componentes/editor-reparto";
import { formatear, type Moneda } from "@/lib/parser/montos";
import type { Parte } from "@/lib/reparto";
import { asignarGastoAccion } from "../../actions";

type Persona = { id: number; nombre: string };

const DIVIDIR = "dividir";

export function AsignarGasto(props: {
  gastoId: number;
  centavos: number;
  moneda: Moneda;
  partes: Parte[];
  personas: Persona[];
}) {
  const { gastoId, centavos, moneda, partes, personas } = props;
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();

  const guardar = (nuevas: Parte[], alTerminar?: () => void) =>
    iniciar(async () => {
      const r = await asignarGastoAccion(gastoId, nuevas);
      setError(r.error);
      if (!r.error) alTerminar?.();
    });

  const nombre = (id: number) => personas.find((p) => p.id === id)?.nombre ?? "?";
  const dividido = partes.length > 1;
  const valorSelect = dividido ? DIVIDIR : partes.length === 1 ? String(partes[0].personaId) : "";

  return (
    <div className={pendiente ? "opacity-50" : ""}>
      <select
        value={abierto ? DIVIDIR : valorSelect}
        onChange={(e) => {
          const v = e.target.value;
          if (v === DIVIDIR) return setAbierto(true);
          setAbierto(false);
          guardar(v ? [{ personaId: Number(v), centavos }] : []);
        }}
        disabled={pendiente}
        aria-label="De quién es el gasto"
        className={`w-full min-w-28 rounded border px-1 py-0.5 text-sm ${
          partes.length === 0 ? "border-amber-400 bg-amber-50" : "border-slate-300"
        }`}
      >
        <option value="">— sin asignar —</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>{p.nombre}</option>
        ))}
        <option value={DIVIDIR}>{dividido ? "Dividido…" : "Dividir…"}</option>
      </select>

      {dividido && !abierto && (
        <div className="mt-0.5 text-xs text-slate-500">
          {partes.map((p) => `${nombre(p.personaId)} ${formatear(p.centavos, moneda)}`).join(" · ")}
        </div>
      )}

      {abierto && (
        <EditorReparto
          minimoPersonas={2}
          centavos={centavos}
          moneda={moneda}
          partes={partes}
          personas={personas}
          pendiente={pendiente}
          onCancelar={() => {
            setAbierto(false);
            setError(undefined);
          }}
          onGuardar={(nuevas) => guardar(nuevas, () => setAbierto(false))}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
