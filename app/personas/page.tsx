import { listarPersonas, listarTarjetas } from "@/lib/db";
import { EditorPersonas, SelectorDuenio } from "./editores";

export const dynamic = "force-dynamic";

const NOMBRE_TARJETA: Record<string, string> = { VISA: "Visa", AMEX: "American Express" };

export default async function Personas() {
  const [personas, tarjetas] = await Promise.all([listarPersonas(), listarTarjetas()]);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Personas</h1>
        <p className="text-sm text-slate-600">A quiénes les podés asignar gastos.</p>
        <EditorPersonas personas={personas} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Tarjetas</h2>
        <p className="text-sm text-slate-600">
          Los gastos de cada tarjeta se asignan a su dueño al importar. Si cambiás el dueño, también se le
          asignan los gastos de esa tarjeta que estaban sin asignar.
        </p>
        {tarjetas.length === 0 ? (
          <p className="text-sm text-slate-500">Las tarjetas aparecen acá cuando importás un resumen.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {tarjetas.map((t) => (
              <li key={`${t.tipo_tarjeta}-${t.ultimos_4}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <div className="font-medium">
                    {NOMBRE_TARJETA[t.tipo_tarjeta] ?? t.tipo_tarjeta} terminada en {t.ultimos_4}
                  </div>
                  <div className="text-sm text-slate-500">
                    A nombre de {t.titular} · {t.cantidad_gastos} gastos
                  </div>
                </div>
                <SelectorDuenio
                  tipo={t.tipo_tarjeta}
                  ultimos4={t.ultimos_4}
                  personaId={t.persona_id}
                  personas={personas}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
