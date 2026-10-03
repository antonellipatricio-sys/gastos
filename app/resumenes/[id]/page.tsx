import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerResumen } from "@/lib/db";
import { fechaCorta, formatear } from "@/lib/parser/montos";
import { validar, type Control } from "@/lib/parser/validar";

export const dynamic = "force-dynamic";

const NOMBRE_TARJETA: Record<string, string> = { VISA: "Visa", AMEX: "American Express" };

function Totales({ ARS, USD }: { ARS: number; USD: number }) {
  return (
    <span className="tabular-nums">
      {formatear(ARS, "ARS")} · {formatear(USD, "USD")}
    </span>
  );
}

function FilaControl({ c }: { c: Control }) {
  return (
    <li className={`p-3 text-sm ${c.ok ? "bg-green-50" : "bg-red-50"}`}>
      <div className="font-medium">
        {c.ok ? "✔" : "✘"} {c.nombre}
      </div>
      <div className="mt-1 grid gap-x-6 text-slate-700 sm:grid-cols-2">
        <div>Calculado: <Totales {...c.calculado} /></div>
        <div>Banco: {c.banco ? <Totales {...c.banco} /> : "no encontrado en el PDF"}</div>
        {!c.ok && c.banco && (
          <div className="font-medium text-red-800">Diferencia: <Totales {...c.diferencia} /></div>
        )}
      </div>
    </li>
  );
}

export default async function DetalleResumen({ params }: PageProps<"/resumenes/[id]">) {
  const { id } = await params;
  const datos = await obtenerResumen(Number(id));
  if (!datos) notFound();
  const { resumen, tarjetas, validacion } = datos;
  const controles = validar(validacion);
  const todoOk = controles.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:underline">← Volver</Link>
        <h1 className="mt-1 text-xl font-semibold">
          Resumen {NOMBRE_TARJETA[resumen.tipo_tarjeta] ?? resumen.tipo_tarjeta}
        </h1>
        <p className="text-sm text-slate-600">
          Período {resumen.periodo} · Cierre {fechaCorta(resumen.cierre)} · Vencimiento {fechaCorta(resumen.vencimiento)}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Validación {todoOk ? <span className="text-green-700">✔ todo coincide</span> : <span className="text-red-700">✘ hay diferencias</span>}
        </h2>
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
          {controles.map((c) => <FilaControl key={c.nombre} c={c} />)}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="text-slate-500">Pago anterior y devoluciones</div>
          <Totales {...validacion.totalPagos} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="text-slate-500">Impuestos, intereses y percepciones</div>
          <Totales {...validacion.totalImpuestos} />
        </div>
      </section>

      {tarjetas.map((t) => (
        <section key={t.ultimos4} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2">
            <h2 className="font-semibold">
              {t.titular} <span className="font-normal text-slate-500">· terminada en {t.ultimos4}</span>
            </h2>
            <span className="text-sm font-medium"><Totales {...t.suma} /></span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Fecha</th>
                  <th className="px-3 py-1.5 font-medium">Descripción</th>
                  <th className="px-3 py-1.5 font-medium">Cuota</th>
                  <th className="px-3 py-1.5 font-medium">Comprobante</th>
                  <th className="px-3 py-1.5 text-right font-medium">Pesos</th>
                  <th className="px-3 py-1.5 text-right font-medium">Dólares</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {t.gastos.map((g) => {
                  const centavos = Math.round(g.monto * 100);
                  return (
                    <tr key={g.id}>
                      <td className="whitespace-nowrap px-3 py-1.5">{fechaCorta(g.fecha)}</td>
                      <td className="px-3 py-1.5">{g.descripcion}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {g.cuota_actual !== null ? `${g.cuota_actual} de ${g.cuotas_totales}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500">{g.comprobante}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                        {g.moneda === "ARS" ? formatear(centavos, "ARS") : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                        {g.moneda === "USD" ? formatear(centavos, "USD") : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
