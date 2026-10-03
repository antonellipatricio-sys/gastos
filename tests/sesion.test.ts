// Tests del login de administrador.
import { afterEach, describe, expect, it, vi } from "vitest";
import { crearToken, estadoAcceso, passwordCorrecta, tokenValido } from "../lib/sesion";

const SECRETO = "x".repeat(40);

function configurar(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
}

afterEach(() => vi.unstubAllEnvs());

describe("sesión", () => {
  it("una cookie recién creada es válida y una alterada no", () => {
    configurar({ ADMIN_PASSWORD: "clave-larga", SESSION_SECRET: SECRETO });
    const token = crearToken();
    expect(tokenValido(token)).toBe(true);
    const [v, vence, firma] = token.split(".");
    expect(tokenValido(`${v}.${Number(vence) + 999999}.${firma}`)).toBe(false); // estira el vencimiento
    expect(tokenValido(`${v}.${vence}.${firma.slice(0, -2)}xx`)).toBe(false); // firma falsa
    expect(tokenValido("cualquier-cosa")).toBe(false);
    expect(tokenValido(undefined)).toBe(false);
  });

  it("vence a los 30 días", () => {
    configurar({ ADMIN_PASSWORD: "clave-larga", SESSION_SECRET: SECRETO });
    const ahora = Date.now();
    const token = crearToken(ahora);
    expect(tokenValido(token, ahora + 29 * 86400_000)).toBe(true);
    expect(tokenValido(token, ahora + 31 * 86400_000)).toBe(false);
  });

  it("cambiar la contraseña invalida las sesiones abiertas", () => {
    configurar({ ADMIN_PASSWORD: "clave-vieja", SESSION_SECRET: SECRETO });
    const token = crearToken();
    configurar({ ADMIN_PASSWORD: "clave-nueva" });
    expect(tokenValido(token)).toBe(false);
  });

  it("verifica la contraseña", () => {
    configurar({ ADMIN_PASSWORD: "clave-larga", SESSION_SECRET: SECRETO });
    expect(passwordCorrecta("clave-larga")).toBe(true);
    expect(passwordCorrecta("clave-larg")).toBe(false);
    expect(passwordCorrecta("")).toBe(false);
  });

  it("estados de acceso", () => {
    configurar({ NODE_ENV: "development", ADMIN_PASSWORD: "", SESSION_SECRET: "" });
    expect(estadoAcceso(undefined)).toBe("libre"); // tu compu, sin contraseña

    configurar({ NODE_ENV: "production" });
    expect(estadoAcceso(undefined)).toBe("mal-configurado"); // publicada sin contraseña: bloqueada

    configurar({ ADMIN_PASSWORD: "clave-larga", SESSION_SECRET: "corto" });
    expect(estadoAcceso(undefined)).toBe("mal-configurado"); // secreto demasiado corto

    configurar({ SESSION_SECRET: SECRETO });
    expect(estadoAcceso(undefined)).toBe("sin-sesion");
    expect(estadoAcceso(crearToken())).toBe("ok");
  });
});
