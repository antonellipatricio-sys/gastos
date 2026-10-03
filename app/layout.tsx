import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gastos de tarjetas",
  description: "Control de gastos de tarjetas de crédito",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">💳 Gastos de tarjetas</Link>
            <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">Resúmenes</Link>
            <Link href="/personas" className="text-sm text-slate-600 hover:text-slate-900">Personas y tarjetas</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
