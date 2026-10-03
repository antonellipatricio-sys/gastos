// Login del administrador: una contraseña (ADMIN_PASSWORD) y una cookie de sesión firmada.
//
// La cookie dice "sesión válida hasta tal fecha" + una firma HMAC. La firma solo se puede
// generar conociendo SESSION_SECRET (y la contraseña), así que nadie puede fabricar una
// cookie válida desde afuera. Si cambiás la contraseña, todas las sesiones viejas se invalidan.
//
// Sin ADMIN_PASSWORD (en tu compu, con `npm run dev`) no se pide login.
// En producción sin ADMIN_PASSWORD la app se bloquea: nunca queda publicada sin contraseña.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_SESION = "sesion";
export const DURACION_SESION_SEGUNDOS = 30 * 24 * 60 * 60; // 30 días

export type EstadoAcceso =
  | "libre" // no hay contraseña configurada y estamos en desarrollo
  | "ok" // sesión válida
  | "sin-sesion" // hace falta loguearse
  | "mal-configurado"; // producción sin ADMIN_PASSWORD o sin SESSION_SECRET

function configuracion() {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secreto = process.env.SESSION_SECRET ?? "";
  const produccion = process.env.NODE_ENV === "production";
  return { password, secreto, produccion };
}

export function loginRequerido(): boolean {
  const { password, produccion } = configuracion();
  return password !== "" || produccion;
}

function malConfigurado(): boolean {
  const { password, secreto, produccion } = configuracion();
  if (password === "") return produccion;
  return secreto.length < 32; // con contraseña, el secreto es obligatorio y largo
}

/** La clave de firma combina el secreto con la contraseña: cambiar la contraseña cierra todas las sesiones. */
function clave(): Buffer {
  const { password, secreto } = configuracion();
  return createHash("sha256").update(`${secreto}\u0000${password}`).digest();
}

function firmar(datos: string): string {
  return createHmac("sha256", clave()).update(datos).digest("base64url");
}

/** Compara dos textos en tiempo constante (para no dar pistas por cuánto tarda la comparación). */
function iguales(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Crea el valor de la cookie: "v1.<vencimiento en segundos>.<firma>". */
export function crearToken(ahora: number = Date.now()): string {
  const vence = Math.floor(ahora / 1000) + DURACION_SESION_SEGUNDOS;
  const datos = `v1.${vence}`;
  return `${datos}.${firmar(datos)}`;
}

export function tokenValido(token: string | undefined, ahora: number = Date.now()): boolean {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== "v1") return false;
  const [version, vence, firma] = partes;
  if (!iguales(firma, firmar(`${version}.${vence}`))) return false;
  return Number(vence) * 1000 > ahora;
}

export function passwordCorrecta(intento: string): boolean {
  const { password } = configuracion();
  return password !== "" && iguales(intento, password);
}

export function estadoAcceso(token: string | undefined): EstadoAcceso {
  if (malConfigurado()) return "mal-configurado";
  if (!loginRequerido()) return "libre";
  return tokenValido(token) ? "ok" : "sin-sesion";
}

export const MENSAJE_MAL_CONFIGURADO =
  "La app está publicada sin contraseña. Configurá ADMIN_PASSWORD y SESSION_SECRET (de al menos 32 caracteres) " +
  "en las variables de entorno del hosting y volvé a publicar.";
