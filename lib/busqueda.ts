/**
 * La búsqueda general: folio de OT, código o nombre de equipo, número de
 * serie, refacción, solicitud y proveedor.
 *
 * Tres reglas:
 *  - Sin acentos ni mayúsculas: «valvula» encuentra «Válvula». Las bases no lo
 *    hacen igual (SQLite y PostgreSQL difieren), así que se compara en código
 *    sobre los campos que se buscan, que son pocos y cortos.
 *  - Solo lo que el rol puede abrir (lib/pantallas.ts): buscar no es una
 *    puerta trasera a pantallas ocultas. El solicitante encuentra sus
 *    solicitudes, no las de los demás.
 *  - Siempre dentro de la empresa, y cada registro una vez.
 */
import { prisma } from "./db";
import { puedeVerRuta, veTodasLasSolicitudes } from "./pantallas";

export type Resultado = { tipo: string; id: string; titulo: string; contexto: string; enlace: string; estado?: string };
export type GrupoResultados = { tipo: string; etiqueta: string; resultados: Resultado[] };

const LIMITE = 20;
export const normalizar = (t: string | null | undefined) =>
  (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function coincide(q: string, ...campos: Array<string | null | undefined>) {
  const palabras = q.split(/\s+/).filter(Boolean);
  const texto = normalizar(campos.filter(Boolean).join(" "));
  return palabras.every((p) => texto.includes(p));
}

export async function buscar(
  user: { id: string; role: string; isSuperAdmin: boolean; organizationId: string },
  consulta: string,
): Promise<GrupoResultados[]> {
  const q = normalizar(consulta);
  if (q.length < 2) return [];
  const org = user.organizationId;
  const ve = (ruta: string) => puedeVerRuta(user.role, ruta, { esSuperAdmin: user.isSuperAdmin });
  const grupos: GrupoResultados[] = [];

  const [ordenes, activos, refacciones, solicitudes, proveedores] = await Promise.all([
    ve("/work-orders")
      ? prisma.workOrder.findMany({
          where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 5000,
          select: { id: true, number: true, title: true, status: true, asset: { select: { code: true, name: true } } },
        })
      : [],
    ve("/assets")
      ? prisma.asset.findMany({
          where: { organizationId: org, active: true }, take: 5000,
          select: { id: true, code: true, name: true, serialNumber: true, manufacturer: true, model: true, status: true, location: { select: { name: true } } },
        })
      : [],
    ve("/inventory")
      ? prisma.part.findMany({
          where: { organizationId: org, active: true }, take: 5000,
          select: { id: true, code: true, name: true, description: true, category: true, quantityOnHand: true, unit: true },
        })
      : [],
    ve("/requests")
      ? prisma.workRequest.findMany({
          where: { organizationId: org, ...(veTodasLasSolicitudes(user.role) ? {} : { requestedById: user.id }) },
          orderBy: { createdAt: "desc" }, take: 3000,
          select: { id: true, number: true, title: true, status: true },
        })
      : [],
    ve("/suppliers")
      ? prisma.supplier.findMany({ where: { organizationId: org }, take: 2000, select: { id: true, name: true, rfc: true, contactName: true } })
      : [],
  ]);

  const agregar = (tipo: string, etiqueta: string, resultados: Resultado[]) => {
    const vistos = new Set<string>();
    const unicos = resultados.filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true)));
    if (unicos.length) grupos.push({ tipo, etiqueta, resultados: unicos.slice(0, LIMITE) });
  };

  // El folio exacto primero: «OT-000123» debe salir arriba aunque haya títulos que lo mencionen.
  const exactoPrimero = <T extends { titulo: string }>(xs: T[], clave: (x: T) => string) =>
    [...xs].sort((a, b) => Number(normalizar(clave(b)) === q) - Number(normalizar(clave(a)) === q));

  // Los equipos van primero, y no es casual: se busca por nombre de equipo
  // mucho mas seguido que por folio. Quien busca una orden concreta escribe
  // su folio completo, y ese sale arriba de su propio grupo de todos modos.
  agregar("activo", "Equipos", exactoPrimero(
    activos.filter((a) => coincide(q, a.code, a.name, a.serialNumber, a.manufacturer, a.model)).map((a) => ({
      tipo: "activo", id: a.id, titulo: `${a.code} · ${a.name}`,
      contexto: [a.location?.name, a.manufacturer, a.model, a.serialNumber ? `Serie ${a.serialNumber}` : null].filter(Boolean).join(" · ") || "—",
      enlace: `/assets/${a.id}`, estado: a.status, codigo: a.code,
    })), (x) => x.codigo));
  agregar("orden", "Órdenes de trabajo", exactoPrimero(
    ordenes.filter((o) => coincide(q, o.number, o.title, o.asset?.code, o.asset?.name)).map((o) => ({
      tipo: "orden", id: o.id, titulo: `${o.number} · ${o.title}`, contexto: o.asset ? `${o.asset.code} · ${o.asset.name}` : "Sin equipo",
      enlace: `/work-orders/${o.id}`, estado: o.status, folio: o.number,
    })), (x) => x.folio));
  agregar("refaccion", "Refacciones", exactoPrimero(
    refacciones.filter((p) => coincide(q, p.code, p.name, p.description, p.category)).map((p) => ({
      tipo: "refaccion", id: p.id, titulo: `${p.code} · ${p.name}`, contexto: `${p.category ?? "Sin categoría"} · ${p.quantityOnHand} ${p.unit} en existencia`,
      enlace: `/inventory?q=${encodeURIComponent(p.code)}`, codigo: p.code,
    })), (x) => x.codigo));
  agregar("solicitud", veTodasLasSolicitudes(user.role) ? "Solicitudes" : "Mis reportes",
    solicitudes.filter((s) => coincide(q, s.number, s.title)).map((s) => ({
      tipo: "solicitud", id: s.id, titulo: `${s.number} · ${s.title}`, contexto: "Solicitud", enlace: `/requests/${s.id}`, estado: s.status,
    })));
  agregar("proveedor", "Proveedores",
    proveedores.filter((p) => coincide(q, p.name, p.rfc, p.contactName)).map((p) => ({
      tipo: "proveedor", id: p.id, titulo: p.name, contexto: [p.rfc, p.contactName].filter(Boolean).join(" · ") || "Proveedor",
      enlace: `/suppliers?q=${encodeURIComponent(p.name)}`,
    })));
  return grupos;
}
