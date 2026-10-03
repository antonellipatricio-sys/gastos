"use client";
// Sección "Impuestos, intereses y percepciones" de un resumen: elegir cómo se reparten.

import { useState, useTransition } from "react";
import { EditorReparto } from "@/app/componentes/editor-reparto";
import { formatear, type Moneda } from "@/lib/parser/montos";
import type { Parte } from "@/lib/reparto";
import type { CriterioImpuestos, ImpuestoManual, LineaImpuesto } from "@/lib/saldos";
import { borrarResumenAccion, cambiarCriterioAccion, guardarImpuestosManualAccion } from "../../actions";

type Persona = { id: number; nombre: string };

const OPCIONES: { valor: CriterioImpuestos; titulo: string; ayuda: string }[] = [
  {
    valor: "proporcional",
    titulo: "Proporcional",
    ayuda:
      "Las percepciones sobre dólares (RG 5617, IVA RG 4240, IIBB) se reparten según lo que gastó cada uno en dólares; los intereses y su IVA, según lo gastado en pesos.",
  },
  { valor: "yo", titulo: "Los pago yo", ayuda: "No se le cobran impuestos a nadie." },
  { valor: "manual", titulo: "Manual", ayuda: "Cargás cuánto paga cada uno." },
];

export function Impuestos(props: {
  resumenId: number;
  criterio: CriterioImpuestos;
  lineas: LineaImpuesto[];
  sinDetalle: boolean;
  total: { ARS: number; USD: number };
  porPersona: { personaId: number; ARS: number; USD: number }[];
  personas: Persona[];
}) {
  const { resumenId, criterio, lineas, total, porPersona, personas } = props;
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();
  const nombre = (id: number) => personas.find((p) => p.id === id)?.nombre ?? "?";

  const elegir = (valor: CriterioImpuestos) => {
    setError(undefined);
    // "Manual" abre el editor: el criterio cambia recién cuando guardás un reparto válido.
    if (valor === "manual") return setEditando(true);
    setEditando(false);
    iniciar(async () => setError((await cambiarCriterioAccion(resumenId, valor)).error));
  };

  // Partes actuales por moneda, como punto de partida del editor manual.
  const partesDe = (m: Moneda): Parte[] =>
    porPersona.filter((p) => p[m] !== 0).map((p) => ({ personaId: p.personaId, centavos: p[m] }));

  const guardarMoneda = (m: Moneda, nuevas: Parte[]) => {
    const otra: Moneda = m === "ARS" ? "USD" : "ARS";
    const todas: ImpuestoManual[] = [
      ...nuevas.map((p) => ({ ...p, moneda: m })),
      ...partesDe(otra).map((p) => ({ ...p, moneda: otra })),
    ];
    iniciar(async () => {
      const r = await guardarImpuestosManualAccion(resumenId, todas);
      setError(r.error);
      if (!r.error) setEditando(false);
    });
  };

  if (total.ARS === 0 && total.USD === 0) {
    return <p className="text-sm text-slate-500">Este resumen no tiene impuestos ni intereses.</p>;
  }

  return (
    <div className={`space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm ${pendiente ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          Total: <span className="font-medium tabular-nums">{formatear(total.ARS, "ARS")}</span>
          {total.USD !== 0 && <span className="tabular-nums"> · {formatear(total.USD, "USD")}</span>}
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Cómo se reparten los impuestos">
          {OPCIONES.map((o) => {
            const activo = editando ? o.valor === "manual" : criterio === o.valor;
            return (
              <button
                key={o.valor}
                role="radio"
                aria-checked={activo}
                onClick={() => elegir(o.valor)}
                disabled={pendiente}
                className={`rounded border px-3 py-1 ${activo ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:bg-slate-50"}`}
              >
                {o.titulo}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-slate-600">{OPCIONES.find((o) => o.valor === (editando ? "manual" : criterio))?.ayuda}</p>
      {props.sinDetalle && criterio === "proporcional" && (
        <p className="rounded bg-amber-50 p-2 text-amber-900">
          Este resumen se importó antes de guardar el detalle de cada impuesto, así que se reparte todo según el
          consumo en pesos. Para el reparto fino, borralo (abajo de todo) y volvé a importar el PDF.
        </p>
      )}

      {editando ? (
        <div className="flex flex-wrap gap-4">
          {(["ARS", "USD"] as const)
            .filter((m) => total[m] !== 0)
            .map((m) => (
              <div key={m}>
                <div className="font-medium">En {m === "ARS" ? "pesos" : "dólares"}</div>
                <EditorReparto
                  minimoPersonas={1}
                  centavos={total[m]}
                  moneda={m}
                  partes={partesDe(m)}
                  personas={personas}
                  pendiente={pendiente}
                  onCancelar={() => setEditando(false)}
                  onGuardar={(partes) => guardarMoneda(m, partes)}
                />
              </div>
            ))}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3">
          {porPersona.map((p) => (
            <li key={p.personaId} className="rounded border border-slate-200 p-2">
              <div className="font-medium">{nombre(p.personaId)}</div>
              <span className="tabular-nums">
                {formatear(p.ARS, "ARS")}
                {p.USD !== 0 && ` · ${formatear(p.USD, "USD")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-red-700">{error}</p>}

      {lineas.length > 0 && !props.sinDetalle && (
        <details>
          <summary className="cursor-pointer text-slate-600">Ver las {lineas.length} líneas del resumen</summary>
          <ul className="mt-1 space-y-0.5">
            {lineas.map((l, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{l.descripcion}</span>
                <span className="tabular-nums">{formatear(l.centavos, l.moneda)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function BorrarResumen({ resumenId }: { resumenId: number }) {
  const [pendiente, iniciar] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm("¿Borrar este resumen con todos sus gastos y repartos? Después lo podés volver a importar.")) return;
        iniciar(async () => {
          await borrarResumenAccion(resumenId);
        });
      }}
      disabled={pendiente}
      className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
    >
      {pendiente ? "Borrando…" : "Borrar resumen"}
    </button>
  );
}
