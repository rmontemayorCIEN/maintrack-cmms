import { prisma } from "@/lib/db";
import { puedeVerRuta } from "@/lib/pantallas";

/**
 * De que registros se puede colgar algo: un comentario, un compromiso, una
 * suscripcion para enterarse.
 *
 * ── Un solo registro, y por que ──
 *
 * Tres funciones necesitan lo mismo de cualquier registro: si esta persona
 * puede verlo, a donde lleva su pantalla, y como se llama para decirlo en un
 * aviso. Repartir eso en tres archivos era garantizar que un dia comentar
 * pidiera un permiso y observar otro sobre el mismo registro.
 *
 * ── Agregar un lugar es un renglon ──
 *
 * Rafael: «los compromisos puedes ponerlos en mas lugares porque es donde se
 * da el momento». Un compromiso nace en una conversacion sobre una compra,
 * sobre un plan, sobre un rondin. Con esta tabla, sumar uno es agregar una
 * entrada; sin ella era una columna en la base y una migracion cada vez.
 *
 * ── El nombre que se usa es el de `emitirAviso` ──
 *
 * WorkOrder, Asset, PurchaseRequest: las mismas cadenas con las que el sistema
 * ya identifica sus entidades al avisar. Inventar un vocabulario paralelo
 * habria obligado a traducir en los dos sentidos.
 */

export type Anclable = {
  /** Como se identifica en los avisos. */
  entidad: string;
  /** La pantalla que decide quien puede verlo (`lib/pantallas.ts`). */
  pantalla: string;
  /** Busca el registro en ESTA empresa y devuelve como llamarlo. Null si no es suyo. */
  resolver: (organizationId: string, id: string) => Promise<{ enlace: string; comoSeLlama: string } | null>;
};


export const ANCLABLES: Anclable[] = [
  {
    entidad: "WorkOrder", pantalla: "/work-orders",
    resolver: async (org, id) => {
      const r = await prisma.workOrder.findFirst({ where: { id, organizationId: org }, select: { number: true } });
      return r && { enlace: `/work-orders/${id}`, comoSeLlama: `la orden ${r.number}` };
    },
  },
  {
    entidad: "Asset", pantalla: "/assets",
    resolver: async (org, id) => {
      const r = await prisma.asset.findFirst({ where: { id, organizationId: org }, select: { code: true, name: true } });
      return r && { enlace: `/assets/${id}`, comoSeLlama: `el equipo ${r.code} ${r.name}`.trim() };
    },
  },
  {
    entidad: "WorkRequest", pantalla: "/requests",
    resolver: async (org, id) => {
      const r = await prisma.workRequest.findFirst({ where: { id, organizationId: org }, select: { number: true } });
      return r && { enlace: `/requests/${id}`, comoSeLlama: `la solicitud ${r.number}` };
    },
  },
  {
    entidad: "MaterialRequest", pantalla: "/requisiciones",
    resolver: async (org, id) => {
      const r = await prisma.materialRequest.findFirst({ where: { id, organizationId: org }, select: { folio: true } });
      return r && { enlace: `/requisiciones/${id}`, comoSeLlama: `la requisición ${r.folio}` };
    },
  },
  // ── Los que Rafael pidió: donde se dan los acuerdos que hoy se quedan en el aire.
  {
    // «Cotiza con tres proveedores», «habla con el proveedor por la fecha».
    entidad: "PurchaseRequest", pantalla: "/compras",
    resolver: async (org, id) => {
      const r = await prisma.purchaseRequest.findFirst({ where: { id, organizationId: org }, select: { folio: true } });
      return r && { enlace: `/compras/${id}`, comoSeLlama: `la compra ${r.folio}` };
    },
  },
  {
    // «Hay que revisar esta frecuencia con producción».
    entidad: "MaintenancePlan", pantalla: "/plans",
    resolver: async (org, id) => {
      const r = await prisma.maintenancePlan.findFirst({ where: { id, organizationId: org }, select: { name: true } });
      return r && { enlace: `/plans/${id}`, comoSeLlama: `el plan ${r.name}` };
    },
  },
  {
    // De un hallazgo del recorrido sale trabajo que no siempre es una orden.
    entidad: "Rondin", pantalla: "/rondines",
    resolver: async (org, id) => {
      const r = await prisma.rondin.findFirst({ where: { id, organizationId: org }, select: { numero: true } });
      return r && { enlace: `/rondines/${id}`, comoSeLlama: `el rondín ${r.numero}` };
    },
  },
  {
    entidad: "Conjunto", pantalla: "/conjuntos",
    resolver: async (org, id) => {
      const r = await prisma.conjunto.findFirst({ where: { id, organizationId: org }, select: { code: true, name: true } });
      return r && { enlace: `/conjuntos/${id}`, comoSeLlama: `el sistema ${r.code} ${r.name}`.trim() };
    },
  },
  {
    // «Consigue el equivalente», «pide cotización de este número de parte».
    entidad: "Part", pantalla: "/inventory",
    resolver: async (org, id) => {
      const r = await prisma.part.findFirst({ where: { id, organizationId: org }, select: { code: true, name: true } });
      return r && { enlace: `/inventory/${id}`, comoSeLlama: `la refacción ${r.code} ${r.name}`.trim() };
    },
  },
];

export const ENTIDADES_ANCLABLES = ANCLABLES.map((a) => a.entidad);

/**
 * ¿Puede esta persona colgar algo de este registro?
 *
 * Dos condiciones, y las dos hacen falta: que su rol vea esa pantalla, y que
 * el registro sea de SU empresa. Sin la segunda, un identificador copiado de
 * otra cuenta dejaria escribir —y avisar— dentro de datos ajenos. Es la regla
 * 7 de CLAUDE.md en el caso mas facil de olvidar: el que no consulta datos,
 * solo escribe.
 */
export async function registroAnclable(
  organizationId: string,
  rol: string,
  entidad: string,
  entidadId: string,
  contexto: { esSuperAdmin?: boolean; esDemo?: boolean } = {},
): Promise<{ ok: true; enlace: string; comoSeLlama: string } | { ok: false; motivo: string }> {
  const anclable = ANCLABLES.find((a) => a.entidad === entidad);
  if (!anclable) return { ok: false, motivo: "De ese tipo de registro no se puede colgar nada." };

  if (!puedeVerRuta(rol, anclable.pantalla, contexto)) {
    return { ok: false, motivo: "Esta pantalla no es de su perfil." };
  }

  const r = await anclable.resolver(organizationId, entidadId);
  if (!r) return { ok: false, motivo: "Ese registro no existe o no es de su empresa." };
  return { ok: true, ...r };
}
