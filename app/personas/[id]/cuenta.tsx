"use client";
// Partes interactivas de la cuenta de una persona: registrar y borrar pagos, y el detalle para mandar.

import { useMemo, useState, useTransition } from "react";
import { fechaCorta, formatear, leerImporte } from "@/lib/parser/montos";
import { armarDetalle, type GastoDelDetalle, type Movimiento } from "@/lib/saldos";
import { borrarPagoAccion, registrarPagoAccion } from "../../actions";

// Fecha de hoy en hora local (toISOString usa UTC: en Argentina, después de las 21 daría mañana).
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function RegistrarPago({ personaId }: { personaId: number }) {
  const [fecha, setFecha] = useState(hoy);
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [monto, setMonto] = useState("");
  const [enPesos, setEnPesos] = useState(false);
  const [pesos, setPesos] = useState("");
  const [tipoCambio, setTipoCambio] = useState("");
  const [nota, setNota] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string }>();
  const [pendiente, iniciar] = useTransition();

  // Pago de dólares hecho con pesos: los dólares cancelados salen de pesos ÷ cotización.
  const pesosCentavos = leerImporte(pesos);
  const tc = Number(tipoCambio.replace(",", "."));
  const dolaresDesdePesos = enPesos && pesosCentavos && tc > 0 ? Math.round(pesosCentavos / tc) : null;

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const centavos = moneda === "USD" && enPesos ? dolaresDesdePesos : leerImporte(monto);
    if (!centavos || centavos <= 0) return setMensaje({ ok: false, texto: "Revisá el monto." });
    iniciar(async () => {
      const r = await registrarPagoAccion({
        personaId,
        fecha,
        moneda,
        centavos,
        pagadoEnPesos: moneda === "USD" && enPesos ? pesosCentavos : null,
        tipoCambio: moneda === "USD" && enPesos ? tc : null,
        nota,
      });
      if (r.error) return setMensaje({ ok: false, texto: r.error });
      setMensaje({ ok: true, texto: `Pago de ${formatear(centavos, moneda)} registrado.` });
      setMonto("");
      setPesos("");
      setNota("");
    });
  };

  const campo = "rounded border border-slate-300 px-2 py-1";
  return (
    <form onSubmit={guardar} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required className={campo} />
        </label>
        <label className="flex flex-col gap-1">
          Cancela deuda en
          <select value={moneda} onChange={(e) => setMoneda(e.target.value as "ARS" | "USD")} className={campo}>
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
        </label>
        {moneda === "USD" && (
          <label className="flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={enPesos} onChange={(e) => setEnPesos(e.target.checked)} />
            Me pagó con pesos
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {moneda === "USD" && enPesos ? (
          <>
            <label className="flex flex-col gap-1">
              Pesos que te dio
              <input value={pesos} onChange={(e) => setPesos(e.target.value)} inputMode="decimal" placeholder="150.000" className={`${campo} w-36 text-right`} />
            </label>
            <label className="flex flex-col gap-1">
              Cotización
              <input value={tipoCambio} onChange={(e) => setTipoCambio(e.target.value)} inputMode="decimal" placeholder="1500" className={`${campo} w-24 text-right`} />
            </label>
            <span className="pb-1.5 text-slate-600">
              = cancela {dolaresDesdePesos ? formatear(dolaresDesdePesos, "USD") : "U$S —"}
            </span>
          </>
        ) : (
          <label className="flex flex-col gap-1">
            Monto ({moneda === "ARS" ? "$" : "U$S"})
            <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Monto del pago" className={`${campo} w-36 text-right`} />
          </label>
        )}
        <label className="flex flex-1 flex-col gap-1">
          Nota (opcional)
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Transferencia, efectivo…" className={`${campo} min-w-40`} />
        </label>
        <button disabled={pendiente} className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50">
          {pendiente ? "Guardando…" : "Registrar pago"}
        </button>
      </div>
      {mensaje && <p className={mensaje.ok ? "text-green-700" : "text-red-700"}>{mensaje.texto}</p>}
    </form>
  );
}

export function BorrarPago({ pagoId }: { pagoId: number }) {
  const [pendiente, iniciar] = useTransition();
  return (
    <button
      onClick={() => confirm("¿Borrar este pago?") && iniciar(async () => void (await borrarPagoAccion(pagoId)))}
      disabled={pendiente}
      title="Borrar pago"
      aria-label="Borrar pago"
      className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
    >
      ✕
    </button>
  );
}

export function DetalleParaMandar(props: {
  nombre: string;
  movimientos: Movimiento[];
  gastosPorResumen: [number, GastoDelDetalle[]][];
}) {
  // Opciones de "desde": el principio o el cierre de cada resumen.
  const cierres = [...new Set(props.movimientos.filter((m) => m.tipo === "cargo").map((m) => m.fecha))];
  const [desde, setDesde] = useState<string>(cierres.at(-1) ?? "");
  const [copiado, setCopiado] = useState(false);

  const texto = useMemo(
    () =>
      armarDetalle({
        nombre: props.nombre,
        movimientos: props.movimientos,
        desde: desde || null,
        gastosPorResumen: new Map(props.gastosPorResumen),
      }),
    [props.nombre, props.movimientos, props.gastosPorResumen, desde],
  );

  const copiar = async () => {
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Desde{" "}
          <select value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
            <option value="">el principio</option>
            {cierres.map((c) => (
              <option key={c} value={c}>el cierre del {fechaCorta(c)}</option>
            ))}
          </select>
        </label>
        <button onClick={copiar} className="rounded bg-slate-900 px-3 py-1 font-medium text-white">
          {copiado ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      <pre aria-label="Detalle para mandar" className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans">
        {texto}
      </pre>
    </div>
  );
}
