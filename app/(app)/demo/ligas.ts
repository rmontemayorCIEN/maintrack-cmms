import { prisma } from "@/lib/db";
import { puedeVerRuta } from "@/lib/pantallas";
import { HISTORIAS } from "@/lib/demo-guia";
import type { Liga } from "@/lib/demo-presentacion";

/**
 * Las ligas de cada historia, resueltas contra esta empresa demostrativa.
 *
 * Las historias señalan registros por su clave («LLN-101», «SS-000001»)
 * porque el identificador cambia cada vez que se restaura la demo. Aquí se
 * traducen a direcciones reales, una sola vez para las dos pantallas que las
 * usan: la guía y la presentación.
 *
 * Solo salen las que el rol puede abrir: un botón que lleva a «Sin permiso»
 * delante del cliente es peor que no tenerlo.
 */
export async function ligasDeHistorias(orgId: string, rol: string): Promise<Record<string, Liga[]>> {
  const cache = new Map<string, string | null>();

  async function resolver(tipo: string, clave: string): Promise<string | null> {
    const llave = `${tipo}:${clave}`;
    if (cache.has(llave)) return cache.get(llave)!;
    let href: string | null = null;
    if (tipo === "ruta") href = clave;
    else if (tipo === "activo") { const x = await prisma.asset.findFirst({ where: { organizationId: orgId, code: clave }, select: { id: true } }); href = x ? `/assets/${x.id}` : null; }
    else if (tipo === "solicitud") { const x = await prisma.workRequest.findFirst({ where: { organizationId: orgId, number: clave }, select: { id: true } }); href = x ? `/requests/${x.id}` : null; }
    else if (tipo === "refaccion") { const x = await prisma.part.findFirst({ where: { organizationId: orgId, code: clave }, select: { id: true } }); href = x ? `/inventory/${x.id}` : null; }
    else if (tipo === "orden") { const x = await prisma.workOrder.findFirst({ where: { organizationId: orgId, number: clave }, select: { id: true } }); href = x ? `/work-orders/${x.id}` : null; }
    cache.set(llave, href);
    return href;
  }

  const salida: Record<string, Liga[]> = {};
  for (const h of HISTORIAS) {
    const ligas: Liga[] = [];
    for (const r of h.registros) {
      const href = await resolver(r.tipo, r.clave);
      if (href && puedeVerRuta(rol, href, { esDemo: true })) ligas.push({ etiqueta: r.etiqueta, href });
    }
    salida[h.clave] = ligas;
  }
  return salida;
}
