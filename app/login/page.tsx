import { FormularioLogin } from "./formulario";

export const metadata = { title: "Entrar · Gastos de tarjetas" };

export default function Login() {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Entrar</h1>
      <FormularioLogin />
    </div>
  );
}
