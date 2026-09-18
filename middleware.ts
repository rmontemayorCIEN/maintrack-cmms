import { NextResponse, type NextRequest } from "next/server";

/**
 * Pasa la ruta pedida al layout de la aplicación.
 *
 * Un layout de Next no sabe qué página está envolviendo. Sin esto, la guardia
 * de pantallas por rol (lib/pantallas.ts) tendría que repetirse en cada una de
 * las 57 páginas, y la que se olvide queda abierta. Aquí solo se anota la ruta:
 * quién es y qué puede ver lo decide el layout con la sesión de la base.
 */
export function middleware(request: NextRequest) {
  const cabeceras = new Headers(request.headers);
  cabeceras.set("x-ruta", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: cabeceras } });
}

export const config = {
  // Solo páginas: la API tiene su propia guardia (withAuth) y lo estático no la necesita.
  matcher: ["/((?!api|_next|favicon|icon|manifest|sw\\.js|.*\\.(?:png|jpg|svg|ico|webmanifest|js|css)$).*)"],
};
