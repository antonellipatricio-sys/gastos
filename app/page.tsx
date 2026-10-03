import Link from "next/link";
import { listarResumenes } from "@/lib/db";
import { fechaCorta, formatear } from "@/lib/parser/montos";
import { SubirPdf } from "./subir-pdf";

// La lista sale de la base en cada visita (no se arma una sola vez al compilar).
export const dynamic = "force-dynamic";

const NOMBRE_TARJETA: Record<string, string> = { VISA: "Visa", AMEX: "American Express" };

export default async function Inicio() {
  const resumenes = await listarResumenes();

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Importar resumen</h1>
        <SubirPdf />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Resúmenes importados</h2>
        {resumenes.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no importaste ninguno.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {resumenes.map((r) => (
              <li key={r.id}>
                <Link href={`/resumenes/${r.id}`} className="flex flex-wrap justify-between gap-2 p-3 hover:bg-slate-50">
                  <span>
                    <span className="font-medium">{NOMBRE_TARJETA[r.tipo_tarjeta] ?? r.tipo_tarjeta}</span>
                    <span className="text-slate-500"> · período {r.periodo} · vence {fechaCorta(r.vencimiento)}</span>
                  </span>
                  <span className="text-sm text-slate-600">
                    {r.cantidad_gastos} gastos
                    {r.sin_asignar > 0 && <span className="text-amber-700"> ({r.sin_asignar} sin asignar)</span>}
                    {r.total_a_pagar_pesos !== null &&
                      ` · total ${formatear(Math.round(r.total_a_pagar_pesos * 100), "ARS")}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
