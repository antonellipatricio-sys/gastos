"use client";
// Editor para repartir un monto entre personas (partes iguales o montos a mano).
// Se usa para dividir un gasto y para el reparto manual de impuestos.

import { useState } from "react";
import { formatear, leerImporte, type Moneda } from "@/lib/parser/montos";
import { partesIguales, validarReparto, type Parte } from "@/lib/reparto";

type Persona = { id: number; nombre: string };

export function EditorReparto(props: {
  /** Cuántas personas con monto hacen falta como mínimo (2 para dividir un gasto, 1 para impuestos). */
  minimoPersonas: number;
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
    if (partes.length < props.minimoPersonas) {
      return setError(
        props.minimoPersonas > 1 ? "Para dividir elegí al menos dos personas con monto." : "Elegí al menos una persona con monto.",
      );
    }
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
        <button type="button" onClick={iguales} disabled={elegidas.length < 1} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">
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
