import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { COOKIE_SESION, estadoAcceso } from "@/lib/sesion";
import { cerrarSesionAccion } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gastos de tarjetas",
  description: "Control de gastos de tarjetas de crédito",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // El menú y el botón "Salir" se muestran solo con una sesión iniciada (o sin login, en tu compu).
  const estado = estadoAcceso((await cookies()).get(COOKIE_SESION)?.value);
  const adentro = estado === "ok" || estado === "libre";
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold">💳 Gastos de tarjetas</Link>
            {adentro && (
              <>
                <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">Resúmenes</Link>
                <Link href="/saldos" className="text-sm text-slate-600 hover:text-slate-900">Saldos</Link>
                <Link href="/personas" className="text-sm text-slate-600 hover:text-slate-900">Personas y tarjetas</Link>
              </>
            )}
            {estado === "ok" && (
              <form action={cerrarSesionAccion} className="ml-auto">
                <button className="text-sm text-slate-600 hover:text-slate-900">Salir</button>
              </form>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
