"use client";
// Componentes con interacción (escribir, borrar, elegir) para la pantalla de personas.

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  asignarDuenioAccion,
  crearPersonaAccion,
  eliminarPersonaAccion,
  renombrarPersonaAccion,
} from "../actions";

type Persona = { id: number; nombre: string; es_yo: number; cantidad_asignaciones: number };

function FilaPersona({ persona }: { persona: Persona }) {
  const [nombre, setNombre] = useState(persona.nombre);
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();
  const cambio = nombre.trim() !== persona.nombre;

  const guardar = () =>
    iniciar(async () => {
      const r = await renombrarPersonaAccion(persona.id, nombre);
      setError(r.error);
    });
  const borrar = () =>
    iniciar(async () => {
      if (!confirm(`¿Borrar a ${persona.nombre}?`)) return;
      const r = await eliminarPersonaAccion(persona.id);
      setError(r.error);
    });

  return (
    <li className="space-y-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cambio && guardar()}
          aria-label={`Nombre de ${persona.nombre}`}
          className="w-48 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        {persona.es_yo === 1 && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">vos</span>}
        <span className="text-sm text-slate-500">{persona.cantidad_asignaciones} gastos asignados</span>
        <Link href={`/personas/${persona.id}`} className="text-sm underline">ver cuenta</Link>
        <span className="ml-auto flex gap-2">
          {cambio && (
            <button onClick={guardar} disabled={pendiente} className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Guardar
            </button>
          )}
          {persona.es_yo !== 1 && persona.cantidad_asignaciones === 0 && (
            <button onClick={borrar} disabled={pendiente} className="rounded px-3 py-1 text-sm text-red-700 hover:bg-red-50">
              Borrar
            </button>
          )}
        </span>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </li>
  );
}

export function EditorPersonas({ personas }: { personas: Persona[] }) {
  const [nueva, setNueva] = useState("");
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();

  const agregar = (e: React.FormEvent) => {
    e.preventDefault();
    iniciar(async () => {
      const r = await crearPersonaAccion(nueva);
      setError(r.error);
      if (!r.error) setNueva("");
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-200">
        {personas.map((p) => (
          // La key incluye el nombre para que el campo se reinicie si cambia desde el servidor.
          <FilaPersona key={`${p.id}-${p.nombre}`} persona={p} />
        ))}
      </ul>
      <form onSubmit={agregar} className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3">
        <input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Nueva persona"
          aria-label="Nueva persona"
          className="w-48 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button disabled={pendiente || !nueva.trim()} className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">
          Agregar
        </button>
        {error && <p className="w-full text-sm text-red-700">{error}</p>}
      </form>
    </div>
  );
}

export function SelectorDuenio(props: {
  tipo: string;
  ultimos4: string;
  personaId: number | null;
  personas: { id: number; nombre: string }[];
}) {
  const [aviso, setAviso] = useState<string>();
  const [pendiente, iniciar] = useTransition();

  const cambiar = (valor: string) =>
    iniciar(async () => {
      const r = await asignarDuenioAccion(props.tipo, props.ultimos4, valor ? Number(valor) : null);
      setAviso(r.error ?? (r.asignados ? `Se asignaron ${r.asignados} gastos que estaban sin asignar.` : undefined));
    });

  return (
    <div className="text-right">
      <label className="text-sm text-slate-600">
        Dueño:{" "}
        <select
          value={props.personaId ?? ""}
          onChange={(e) => cambiar(e.target.value)}
          disabled={pendiente}
          aria-label={`Dueño de la tarjeta ${props.ultimos4}`}
          className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
        >
          <option value="">— sin dueño —</option>
          {props.personas.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </label>
      {aviso && <p className="mt-1 text-xs text-slate-600">{aviso}</p>}
    </div>
  );
}
