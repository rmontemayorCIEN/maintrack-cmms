/**
 * A donde se regresa despues de entrar.
 *
 * Solo a la autorizacion de agentes (/oauth/…): es el unico lugar que hoy
 * manda a alguien a iniciar sesion y espera que vuelva. Una lista cerrada y
 * no «cualquier ruta interna» para que la pantalla de acceso no se vuelva una
 * redireccion abierta: `//otro-sitio.com` tambien empieza con «/».
 */
export function destinoSeguro(siguiente: string | string[] | undefined): string {
  if (typeof siguiente !== "string") return "/dashboard";
  if (!siguiente.startsWith("/oauth/") || siguiente.includes("\\") || siguiente.includes("//")) return "/dashboard";
  return siguiente;
}
