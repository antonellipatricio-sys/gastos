"use client";

import { useActionState } from "react";
import { iniciarSesionAccion } from "../actions";

export function FormularioLogin() {
  const [estado, accion, pendiente] = useActionState(iniciarSesionAccion, { error: undefined });
  return (
    <form action={accion} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <label className="block space-y-1 text-sm">
        <span>Contraseña</span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          className="w-full rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      {estado.error && <p className="text-sm text-red-700">{estado.error}</p>}
      <button disabled={pendiente} className="w-full rounded bg-slate-900 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pendiente ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
