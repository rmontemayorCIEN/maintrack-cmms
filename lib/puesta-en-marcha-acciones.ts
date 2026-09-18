/**
 * Lo que la empresa decide durante la puesta en marcha.
 *
 * Separado del cálculo (`lib/puesta-en-marcha.ts`) porque aquí se ESCRIBE: cada
 * decisión queda en la bitácora, y comenzar a operar pasa por la misma
 * verificación que muestra la pantalla —no por una copia de ella—.
 */
import { prisma } from "./db";
import { logAudit } from "./audit";
import { INSTALACIONES } from "./instalaciones";
import { MODULOS_OPCIONALES, leerModulos, puestaEnMarcha, type ModuloOpcional } from "./puesta-en-marcha";

export class ErrorDePuesta extends Error {
  constructor(message: string, readonly codigo = 422) {
    super(message);
  }
}

/**
 * Declara si la empresa usará un módulo opcional.
 *
 * `null` borra la declaración: el paso vuelve a esperarse. Declarar que NO lo
 * usará no borra ni esconde nada: solo deja de pedirlo en la puesta en marcha.
 */
export async function declararModulo(p: {
  organizationId: string;
  userId: string;
  modulo: ModuloOpcional;
  usa: boolean | null;
}) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: p.organizationId }, select: { modulosPuesta: true } });
  const actuales = leerModulos(org.modulosPuesta);
  if (p.usa === null) delete actuales[p.modulo];
  else actuales[p.modulo] = p.usa;
  await prisma.organization.update({ where: { id: p.organizationId }, data: { modulosPuesta: JSON.stringify(actuales) } });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Organization", entityId: p.organizationId, action: "SETUP_CHANGED",
    summary: `Puesta en marcha: ${MODULOS_OPCIONALES[p.modulo]} — ${p.usa === null ? "sin decidir" : p.usa ? "se usará" : "no se usará"}`,
  });
  return actuales;
}

/** Cambia el tipo de instalación. No resiembra catálogos solo: se ofrece aparte. */
export async function cambiarTipoInstalacion(p: { organizationId: string; userId: string; tipo: string }) {
  if (!(p.tipo in INSTALACIONES)) throw new ErrorDePuesta("Tipo de instalación desconocido");
  const antes = await prisma.organization.findUniqueOrThrow({ where: { id: p.organizationId }, select: { tipoInstalacion: true } });
  await prisma.organization.update({ where: { id: p.organizationId }, data: { tipoInstalacion: p.tipo } });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Organization", entityId: p.organizationId, action: "SETUP_CHANGED",
    summary: `Tipo de instalación: ${antes.tipoInstalacion ?? "sin definir"} → ${p.tipo}`,
  });
}

/**
 * Declara que la empresa empieza a operar.
 *
 * Usa la misma revisión que la pantalla: si ahí aparece algo que impide operar
 * —un paso obligatorio incompleto, datos de demostración cargados—, aquí se
 * rechaza con esa misma lista. No hay una segunda opinión.
 */
export async function comenzarAOperar(p: { organizationId: string; userId: string }) {
  const marcha = await puestaEnMarcha(p.organizationId);
  if (marcha.operandoDesde) throw new ErrorDePuesta("La empresa ya está en operación.", 409);
  if (marcha.impideOperar.length) {
    throw new ErrorDePuesta(`Todavía no se puede: ${marcha.impideOperar.join(" · ")}`, 409);
  }
  const ahora = new Date();
  await prisma.organization.update({ where: { id: p.organizationId }, data: { operandoDesde: ahora } });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Organization", entityId: p.organizationId, action: "OPERATION_STARTED",
    summary: `La empresa comenzó a operar con la puesta en marcha al ${marcha.porcentaje}%`,
  });
  return { operandoDesde: ahora };
}
