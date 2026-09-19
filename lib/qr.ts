/**
 * A dónde lleva un código leído con la cámara (o escrito a mano).
 *
 * Un QR de MainTrack es la liga de un punto de reporte (/reportar/<token>),
 * de un equipo o de una orden. Se valida que sea de ESTA empresa y que el rol
 * pueda abrir el destino; si no, se dice por qué, en palabras. Con sesión, el
 * QR de un equipo abre el equipo (quien lo puede ver) y no el formulario
 * público; el solicitante va al portal, que le ofrece reportar con su usuario.
 */
import { prisma } from "./db";
import { contextoDelPunto } from "./portal";
import { puedeVerRuta, veTodasLasSolicitudes } from "./pantallas";
import { normalizar } from "./busqueda";

export type Resolucion = { destino: string; que: string } | { error: string };

type Usuario = { id: string; role: string; isSuperAdmin: boolean; organizationId: string };

export async function resolverCodigo(user: Usuario, texto: string, origen?: string): Promise<Resolucion> {
  const crudo = texto.trim();
  if (!crudo) return { error: "No se leyó ningún código." };
  const ve = (ruta: string) => puedeVerRuta(user.role, ruta, { esSuperAdmin: user.isSuperAdmin });
  const org = user.organizationId;

  let url: URL | null = null;
  try { url = new URL(crudo); } catch { /* no es una liga: se busca como clave o folio */ }

  if (url) {
    const propio = !origen || url.origin === origen;
    const [, primero, segundo] = url.pathname.split("/");
    const esDeMainTrack = ["reportar", "assets", "work-orders"].includes(primero) && Boolean(segundo);
    if (!esDeMainTrack || (!propio && primero !== "reportar")) {
      return { error: "Ese código no es de MainTrack. Si es la etiqueta de un equipo, escriba su clave abajo." };
    }
    if (primero === "reportar") {
      const punto = await contextoDelPunto(segundo);
      if (!punto || punto.organizationId !== org) return { error: "Ese código no es de su empresa, o el punto ya no existe." };
      if (punto.asset && ve("/assets")) return { destino: `/assets/${punto.asset.id}`, que: `Equipo ${punto.asset.code}` };
      return { destino: `/reportar/${segundo}`, que: "Punto de reporte" };
    }
    if (primero === "assets") {
      const a = await prisma.asset.findFirst({ where: { id: segundo, organizationId: org }, select: { id: true, code: true } });
      if (!a) return { error: "Ese equipo no es de su empresa o ya no existe." };
      if (!ve("/assets")) return { error: "Su rol no abre la ficha de equipos. Para reportar una falla use «Reportar un problema»." };
      return { destino: `/assets/${a.id}`, que: `Equipo ${a.code}` };
    }
    const o = await prisma.workOrder.findFirst({ where: { id: segundo, organizationId: org }, select: { id: true, number: true } });
    if (!o) return { error: "Esa orden no es de su empresa o ya no existe." };
    if (!ve("/work-orders")) return { error: "Su rol no abre órdenes de trabajo." };
    return { destino: `/work-orders/${o.id}`, que: `Orden ${o.number}` };
  }

  // Escrito a mano: clave exacta de equipo, folio de OT o de solicitud; si no, búsqueda.
  const q = normalizar(crudo);
  if (ve("/assets")) {
    const activos = await prisma.asset.findMany({ where: { organizationId: org }, select: { id: true, code: true }, take: 5000 });
    const a = activos.find((x) => normalizar(x.code) === q);
    if (a) return { destino: `/assets/${a.id}`, que: `Equipo ${a.code}` };
  }
  if (ve("/work-orders")) {
    const o = await prisma.workOrder.findFirst({ where: { organizationId: org, number: crudo.toUpperCase() }, select: { id: true, number: true } });
    if (o) return { destino: `/work-orders/${o.id}`, que: `Orden ${o.number}` };
  }
  if (ve("/requests")) {
    const s = await prisma.workRequest.findFirst({
      where: { organizationId: org, number: crudo.toUpperCase(), ...(veTodasLasSolicitudes(user.role) ? {} : { requestedById: user.id }) },
      select: { id: true, number: true },
    });
    if (s) return { destino: `/requests/${s.id}`, que: `Solicitud ${s.number}` };
  }
  return { destino: `/search?q=${encodeURIComponent(crudo)}`, que: "Búsqueda" };
}
