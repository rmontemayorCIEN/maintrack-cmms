/**
 * La empresa desechable de las pruebas que corren contra PRODUCCION.
 *
 * Las pruebas `*-real` llaman al modelo de verdad y por eso se corren con la
 * base de produccion. Para no tocar datos de nadie, cada una crea su propia
 * empresa y la borra al final.
 *
 * ── El defecto que esto arregla ──
 *
 * Las tres borraban con `.catch(() => undefined)`. El 23 de septiembre la
 * limpieza de `prueba-rondin-real` fallo a la mitad, el error se trago, la
 * prueba dijo «Todo bien» y la empresa `rreal-1790187225632` se quedo en
 * produccion cuatro dias, ACTIVA y con plan Enterprise. Se veia como cliente:
 * entro en las cifras del negocio y alguien le emitio una nota de cobro.
 *
 * Por eso aqui, tres defensas:
 *
 *  1. Nace como CUENTA INTERNA. Si alguna vez se queda, no cuenta como cliente
 *     ni genera cobro (Organization.cuentaInterna).
 *  2. El borrado se VERIFICA. Si la empresa sigue ahi, se dice en voz alta con
 *     el id y como quitarla, y la prueba falla. Un «Todo bien» con basura en
 *     produccion es justo lo que no puede volver a pasar.
 *  3. Se borran tambien los ARCHIVOS del almacenamiento. El registro del
 *     adjunto se va con la empresa; el archivo en el bucket no.
 *
 * Y al empezar se avisa si quedo alguna de una corrida anterior.
 */
import { prisma } from "../lib/db";
import { borrarArchivo } from "../lib/almacenamiento";

/** Los prefijos con que nacen. Sirven para encontrar las que se quedaron. */
export const PREFIJOS_DESECHABLES = ["rreal-", "briefreal-", "navr-"] as const;
export type PrefijoDesechable = (typeof PREFIJOS_DESECHABLES)[number];

/** Una hora: una corrida en curso no es una empresa olvidada. */
const VIEJA_MS = 60 * 60_000;

/** Empresas desechables de corridas anteriores que siguen en la base. */
export async function desechablesSueltas() {
  const orgs = await prisma.organization.findMany({
    where: {
      OR: PREFIJOS_DESECHABLES.map((p) => ({ name: { startsWith: p } })),
      createdAt: { lt: new Date(Date.now() - VIEJA_MS) },
    },
    select: { id: true, name: true, createdAt: true },
  });
  return orgs;
}

export async function crearEmpresaDesechable(
  prefijo: PrefijoDesechable,
  datos: { timezone?: string; iaComplemento?: boolean; diasHabiles?: string; currency?: string } = {},
) {
  const sueltas = await desechablesSueltas();
  if (sueltas.length) {
    console.warn(`\n  ATENCION: ${sueltas.length} empresa(s) de pruebas anteriores siguen en la base:`);
    for (const o of sueltas) console.warn(`    ${o.id}  ·  ${o.name}  ·  ${o.createdAt.toISOString()}`);
    console.warn("  Se intentan borrar ahora.\n");
    for (const o of sueltas) await borrarEmpresaDesechable(o.id);
  }

  const sello = `${prefijo}${Date.now()}`;
  const org = await prisma.organization.create({
    data: {
      name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE",
      timezone: datos.timezone ?? "America/Monterrey",
      ...(datos.diasHabiles ? { diasHabiles: datos.diasHabiles } : {}),
      ...(datos.currency ? { currency: datos.currency } : {}),
      ...(datos.iaComplemento ? { iaComplemento: true } : {}),
      cuentaInterna: true,
    },
  });
  return { org, sello };
}

/**
 * Borra la empresa con todo lo suyo, y confirma que ya no esta.
 *
 * Devuelve false si se quedo; en ese caso ya lo dijo en la consola. Nunca
 * lanza: se llama desde un `finally` y no debe tapar el error de la prueba.
 */
export async function borrarEmpresaDesechable(id: string): Promise<boolean> {
  try {
    // Solo borra lo que nacio desechable: un id equivocado no se lleva a un cliente.
    const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
    if (!org) return true;
    if (!PREFIJOS_DESECHABLES.some((p) => org.name.startsWith(p))) {
      console.error(`\n  NO SE BORRA ${id} («${org.name}»): no es una empresa desechable de prueba.`);
      return false;
    }

    // Los archivos primero: con la empresa se van los registros que dicen donde estan.
    const archivos = await prisma.attachment.findMany({ where: { organizationId: id }, select: { storagePath: true } });
    for (const a of archivos) await borrarArchivo(a.storagePath);

    // Las ordenes antes que la empresa, igual que la limpieza de las demas
    // pruebas: sus renglones apuntan a equipos que la cascada borra en otro orden.
    await prisma.workOrder.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  } catch (e) {
    console.error(`\n  Falló el borrado de la empresa de prueba ${id}:`, e instanceof Error ? e.message : e);
  }

  const sigue = await prisma.organization.findUnique({ where: { id }, select: { id: true } }).catch(() => ({ id }));
  if (sigue) {
    console.error(`\n  ATENCION: la empresa de prueba ${id} SIGUE en la base.`);
    console.error("  Nace como cuenta interna, así que no cuenta como cliente ni se cobra, pero hay que quitarla.");
    console.error("  La próxima corrida de cualquier prueba *-real lo vuelve a intentar.\n");
    return false;
  }
  return true;
}
