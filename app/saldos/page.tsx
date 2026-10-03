import Link from "next/link";
import { saldosPorPersona } from "@/lib/db";
import { formatear } from "@/lib/parser/montos";
import type { Totales } from "@/lib/saldos";

export const dynamic = "force-dynamic";

function Saldo({ saldo }: { saldo: Totales }) {
  if (saldo.ARS === 0 && saldo.USD === 0) return <span className="text-green-700">al día</span>;
  const parte = (c: number, m: "ARS" | "USD") =>
    c === 0 ? null : (
      <span className={c > 0 ? "text-slate-900" : "text-green-700"}>
        {formatear(Math.abs(c), m)}
        {c < 0 && " a favor"}
      </span>
    );
  return (
    <span className="tabular-nums">
      {parte(saldo.ARS, "ARS")}
      {saldo.ARS !== 0 && saldo.USD !== 0 && " · "}
      {parte(saldo.USD, "USD")}
    </span>
  );
}

export default async function Saldos() {
  const saldos = await saldosPorPersona();
  const otros = saldos.filter((s) => !s.esYo);
  const vos = saldos.find((s) => s.esYo);
  const total = otros.reduce(
    (t, s) => ({ ARS: t.ARS + Math.max(0, s.saldo.ARS), USD: t.USD + Math.max(0, s.saldo.USD) }),
    { ARS: 0, USD: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Saldos</h1>
        <p className="text-sm text-slate-600">
          Lo que te debe cada uno: todos sus gastos (con su parte de impuestos) menos todo lo que te pagó.
        </p>
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {otros.map((s) => (
          <li key={s.id}>
            <Link href={`/personas/${s.id}`} className="flex flex-wrap items-baseline justify-between gap-2 p-3 hover:bg-slate-50">
              <span className="font-medium">{s.nombre}</span>
              <span className="text-right">
                <Saldo saldo={s.saldo} />
                <span className="block text-xs text-slate-500">
                  gastos {formatear(s.cargos.ARS, "ARS")}
                  {s.cargos.USD !== 0 && ` + ${formatear(s.cargos.USD, "USD")}`} · pagó {formatear(s.pagos.ARS, "ARS")}
                  {s.pagos.USD !== 0 && ` + ${formatear(s.pagos.USD, "USD")}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
        <li className="flex flex-wrap justify-between gap-2 bg-slate-50 p-3 font-medium">
          <span>Total que te deben</span>
          <span className="tabular-nums">
            {formatear(total.ARS, "ARS")}
            {total.USD !== 0 && ` · ${formatear(total.USD, "USD")}`}
          </span>
        </li>
      </ul>

      {vos && (
        <p className="text-sm text-slate-600">
          Lo tuyo ({vos.nombre}): {formatear(vos.cargos.ARS, "ARS")}
          {vos.cargos.USD !== 0 && ` + ${formatear(vos.cargos.USD, "USD")}`} entre gastos e impuestos.
        </p>
      )}
    </div>
  );
}
