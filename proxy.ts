// Proxy de Next.js (antes "middleware"): corre ANTES de cada página o acción.
// Si no hay una sesión válida, manda a /login. Es la primera barrera; las acciones del
// servidor vuelven a verificar la sesión por su cuenta (segunda barrera).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION, estadoAcceso, MENSAJE_MAL_CONFIGURADO } from "@/lib/sesion";

export function proxy(request: NextRequest) {
  const estado = estadoAcceso(request.cookies.get(COOKIE_SESION)?.value);
  const enLogin = request.nextUrl.pathname === "/login";

  if (estado === "mal-configurado") {
    return new NextResponse(MENSAJE_MAL_CONFIGURADO, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (estado === "sin-sesion" && !enLogin) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  if ((estado === "ok" || estado === "libre") && enLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Todo menos los archivos estáticos de Next y el ícono.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
