"use client";
// Celda "De quién" de cada gasto: elegir una persona, dejarlo sin asignar o dividirlo.

import { useState, useTransition } from "react";
import { formatear, leerImporte, type Moneda } from "@/lib/parser/montos";
import { partesIguales, validarReparto, type Parte } from "@/lib/reparto";
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
        <EditorDivision
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

function EditorDivision(props: {
  centavos: number;
  moneda: Moneda;
  partes: Parte[];
  personas: Persona[];
  pendiente: boolean;
  onCancelar: () => void;
  onGuardar: (partes: Parte[]) => void;
}) {
  const { centavos, moneda, personas } = props;
  // Texto de cada campo, por persona. Arranca con el reparto actual.
  const [montos, setMontos] = useState<Record<number, string>>(() =>
    Object.fromEntries(props.partes.map((p) => [p.personaId, (p.centavos / 100).toFixed(2).replace(".", ",")])),
  );
  const [error, setError] = useState<string>();

  const elegidas = personas.filter((p) => p.id in montos);
  const alternar = (id: number) =>
    setMontos((m) => {
      const copia = { ...m };
      if (id in copia) delete copia[id];
      else copia[id] = "";
      return copia;
    });
  const iguales = () =>
    setMontos(
      Object.fromEntries(
        partesIguales(centavos, elegidas.map((p) => p.id)).map((p) => [
          p.personaId,
          (p.centavos / 100).toFixed(2).replace(".", ","),
        ]),
      ),
    );
  const guardar = () => {
    const partes: Parte[] = [];
    for (const p of elegidas) {
      const c = leerImporte(montos[p.id] ?? "");
      if (c === null) return setError(`El monto de ${p.nombre} no es válido.`);
      if (c !== 0) partes.push({ personaId: p.id, centavos: c });
    }
    if (partes.length < 2) return setError("Para dividir elegí al menos dos personas con monto.");
    const problema = validarReparto(partes, centavos);
    if (problema) return setError(problema);
    setError(undefined);
    props.onGuardar(partes);
  };

  const suma = elegidas.reduce((s, p) => s + (leerImporte(montos[p.id] ?? "") ?? 0), 0);

  return (
    <div className="mt-1 w-64 space-y-1.5 rounded border border-slate-300 bg-white p-2 text-sm shadow-sm">
      {personas.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-1.5">
            <input type="checkbox" checked={p.id in montos} onChange={() => alternar(p.id)} />
            {p.nombre}
          </label>
          {p.id in montos && (
            <input
              value={montos[p.id]}
              onChange={(e) => setMontos((m) => ({ ...m, [p.id]: e.target.value }))}
              inputMode="decimal"
              aria-label={`Monto de ${p.nombre}`}
              className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right tabular-nums"
            />
          )}
        </div>
      ))}
      <div className={`text-xs ${suma === centavos ? "text-green-700" : "text-slate-500"}`}>
        Suma {formatear(suma, moneda)} de {formatear(centavos, moneda)}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={iguales} disabled={elegidas.length < 2} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">
          Partes iguales
        </button>
        <button type="button" onClick={guardar} disabled={props.pendiente} className="rounded bg-slate-900 px-2 py-0.5 text-white">
          Guardar
        </button>
        <button type="button" onClick={props.onCancelar} className="rounded px-2 py-0.5 text-slate-600">
          Cancelar
        </button>
      </div>
    </div>
  );
}
