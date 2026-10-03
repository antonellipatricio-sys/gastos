import Link from "next/link";
import { notFound } from "next/navigation";
import { cuentaDePersona } from "@/lib/db";
import { fechaCorta, formatear } from "@/lib/parser/montos";
import { BorrarPago, DetalleParaMandar, RegistrarPago } from "./cuenta";

export const dynamic = "force-dynamic";

export default async function CuentaPersona({ params }: PageProps<"/personas/[id]">) {
  const { id } = await params;
  const cuenta = await cuentaDePersona(Number(id));
  if (!cuenta) notFound();
  const { persona, movimientos, saldo, cuotas, gastosPorResumen } = cuenta;
  const alDia = saldo.ARS === 0 && saldo.USD === 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/saldos" className="text-sm text-slate-500 hover:underline">← Saldos</Link>
        <h1 className="mt-1 text-xl font-semibold">{persona.nombre}</h1>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-500">{persona.esYo ? "Lo tuyo" : "Saldo"}</div>
        <div className="text-2xl font-semibold tabular-nums">
          {alDia ? (
            <span className="text-green-700">Al día</span>
          ) : (
            <>
              {formatear(saldo.ARS, "ARS")}
              {saldo.USD !== 0 && <span> · {formatear(saldo.USD, "USD")}</span>}
            </>
          )}
        </div>
        {(saldo.ARS < 0 || saldo.USD < 0) && <div className="text-sm text-green-700">Un saldo negativo es plata a favor.</div>}
      </section>

      {!persona.esYo && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Registrar pago</h2>
          <RegistrarPago personaId={persona.id} />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Movimientos</h2>
        {movimientos.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no tiene gastos ni pagos.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Fecha</th>
                  <th className="px-3 py-1.5 font-medium">Concepto</th>
                  <th className="px-3 py-1.5 text-right font-medium">Debe</th>
                  <th className="px-3 py-1.5 text-right font-medium">Pagó</th>
                  <th className="px-3 py-1.5 text-right font-medium">Saldo</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movimientos.map((m) => (
                  <tr key={m.tipo === "cargo" ? `c${m.resumenId}` : `p${m.id}`}>
                    <td className="whitespace-nowrap px-3 py-1.5">{fechaCorta(m.fecha)}</td>
                    {m.tipo === "cargo" ? (
                      <>
                        <td className="px-3 py-1.5">
                          <Link href={`/resumenes/${m.resumenId}`} className="underline">{m.titulo}</Link>
                          {(m.impuestos.ARS !== 0 || m.impuestos.USD !== 0) && (
                            <span className="text-xs text-slate-500"> (incluye {formatear(m.impuestos.ARS, "ARS")} de impuestos)</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                          {formatear(m.consumo.ARS + m.impuestos.ARS, "ARS")}
                          {m.consumo.USD + m.impuestos.USD !== 0 && (
                            <div>{formatear(m.consumo.USD + m.impuestos.USD, "USD")}</div>
                          )}
                        </td>
                        <td />
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5">
                          Pago{m.nota && ` · ${m.nota}`}
                          {m.pagadoEnPesos !== null && (
                            <span className="text-xs text-slate-500">
                              {" "}(con {formatear(m.pagadoEnPesos, "ARS")} a {m.tipoCambio})
                            </span>
                          )}
                        </td>
                        <td />
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-green-700">
                          {formatear(m.centavos, m.moneda)}
                        </td>
                      </>
                    )}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {formatear(m.saldo.ARS, "ARS")}
                      {m.saldo.USD !== 0 && <div>{formatear(m.saldo.USD, "USD")}</div>}
                    </td>
                    <td className="px-2">{m.tipo === "pago" && <BorrarPago pagoId={m.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Próximas cuotas</h2>
        {cuotas.lista.length === 0 ? (
          <p className="text-sm text-slate-500">No tiene cuotas pendientes.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Compra</th>
                  <th className="px-3 py-1.5 font-medium">Cuota</th>
                  <th className="px-3 py-1.5 text-right font-medium">Por cuota</th>
                  <th className="px-3 py-1.5 text-right font-medium">Faltan</th>
                  <th className="px-3 py-1.5 text-right font-medium">Pendiente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cuotas.lista.map((c, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">
                      {c.descripcion} <span className="text-xs text-slate-500">· {c.tarjeta}</span>
                    </td>
                    <td className="px-3 py-1.5">{c.cuotaActual} de {c.cuotasTotales}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatear(c.centavosPorCuota, c.moneda)}</td>
                    <td className="px-3 py-1.5 text-right">{c.faltan}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatear(c.totalPendiente, c.moneda)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="px-3 py-1.5" colSpan={4}>Total en cuotas que van a venir</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatear(cuotas.total.ARS, "ARS")}
                    {cuotas.total.USD !== 0 && <div>{formatear(cuotas.total.USD, "USD")}</div>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">
          Calculado con el último resumen importado de cada tarjeta. Estas cuotas todavía no están en el saldo:
          se suman cuando llega cada resumen.
        </p>
      </section>

      {!persona.esYo && movimientos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Detalle para mandarle</h2>
          <DetalleParaMandar
            nombre={persona.nombre}
            movimientos={movimientos}
            gastosPorResumen={[...gastosPorResumen]}
          />
        </section>
      )}
    </div>
  );
}
