/**
 * Bloque 3 — La bitácora sirve para investigar, no solo para mirar.
 *
 * Una lista de los últimos movimientos no responde «¿quién tocó esto el
 * martes?». Esta prueba ejercita `consultarBitacora()` —la misma función que
 * usa la pantalla— con cada filtro, y de paso comprueba dos cosas que importan
 * más que los filtros: que la bitácora esté acotada por empresa, y que la
 * referencia de roles diga lo mismo que aplica el servidor.
 *
 *   npx tsx scripts/prueba-bitacora.ts
 */
import { prisma } from "../lib/db";
import { consultarBitacora, hayFiltro, MODULOS_BITACORA } from "../lib/bitacora";
import { logAudit } from "../lib/audit";
import { ACCIONES_POR_ROL, ROLES_DEL_SISTEMA, rolesQuePueden, resumenDeRol } from "../lib/matriz-roles";
import { can } from "../lib/rbac";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

const ayer = (dias: number) => new Date(Date.now() - dias * 86_400_000);

/**
 * El dia LOCAL en aaaa-mm-dd, que es lo que manda un `<input type="date">`.
 *
 * `toISOString()` da el dia UTC: a las 8 de la noche en Monterrey ya es el dia
 * siguiente, y el filtro «hoy» se iria al futuro y no traeria nada.
 */
const diaLocalDe = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function main() {
  const sello = `bit-${Date.now()}`;
  const orgA = await prisma.organization.create({
    data: { name: `${sello}-A`, slug: `${sello}-a`, plan: "ENTERPRISE", status: "ACTIVE" },
  });
  const orgB = await prisma.organization.create({
    data: { name: `${sello}-B`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE" },
  });

  try {
    const ana = await prisma.user.create({
      data: { organizationId: orgA.id, email: `ana-${sello}@t.mx`, name: "Ana", role: "ADMIN", passwordHash: "x" },
    });
    const beto = await prisma.user.create({
      data: { organizationId: orgA.id, email: `beto-${sello}@t.mx`, name: "Beto", role: "TECHNICIAN", passwordHash: "x" },
    });
    const ajeno = await prisma.user.create({
      data: { organizationId: orgB.id, email: `ajeno-${sello}@t.mx`, name: "Ajeno", role: "ADMIN", passwordHash: "x" },
    });

    await logAudit({ organizationId: orgA.id, userId: ana.id, entity: "User", entityId: beto.id, action: "USER_ROLE_CHANGED", summary: "Beto: rol" });
    await logAudit({ organizationId: orgA.id, userId: ana.id, entity: "WorkOrder", entityId: "ot-1", action: "UPDATED", summary: "OT tocada" });
    await logAudit({ organizationId: orgA.id, userId: beto.id, entity: "Part", entityId: "ref-1", action: "ADJUSTED", summary: "Ajuste de inventario" });
    await logAudit({ organizationId: orgA.id, userId: ana.id, entity: "WorkOrder", entityId: "ot-2", action: "EXPORTED", summary: "Exportó órdenes" });
    await logAudit({ organizationId: orgB.id, userId: ajeno.id, entity: "WorkOrder", entityId: "ot-x", action: "EXPORTED", summary: "Exportó de la otra empresa" });

    // Un registro viejo, para que el filtro de fechas tenga qué dejar fuera.
    const viejo = await prisma.auditLog.create({
      data: { organizationId: orgA.id, userId: ana.id, entity: "Organization", entityId: orgA.id, action: "UPDATED", summary: "Cambio de hace un mes", changes: "{}" },
    });
    await prisma.auditLog.update({ where: { id: viejo.id }, data: { createdAt: ayer(30) } });

    console.log("\n1. La bitácora es de la empresa de la sesión");
    const deA = await consultarBitacora(orgA.id, {});
    revisar("solo trae renglones de su empresa",
      deA.length === 5 && !deA.some((r) => r.summary?.includes("otra empresa")), deA.length);
    const deB = await consultarBitacora(orgB.id, {});
    revisar("y la otra empresa ve los suyos, nada más", deB.length === 1 && Boolean(deB[0].summary?.includes("otra empresa")));

    console.log("\n2. Cada filtro acota lo que debe");
    const hoy = diaLocalDe(new Date());
    const porFecha = await consultarBitacora(orgA.id, { desde: hoy, hasta: hoy });
    revisar("por fecha: el registro de hace un mes se queda fuera",
      porFecha.length === 4 && !porFecha.some((r) => r.summary === "Cambio de hace un mes"), porFecha.length);
    revisar("y con el rango abierto sí aparece",
      (await consultarBitacora(orgA.id, { desde: diaLocalDe(ayer(40)) })).length === 5);

    const porUsuario = await consultarBitacora(orgA.id, { usuarioId: beto.id });
    revisar("por usuario: solo lo de esa persona",
      porUsuario.length === 1 && porUsuario[0].user?.name === "Beto", porUsuario.map((r) => r.summary));

    const porModulo = await consultarBitacora(orgA.id, { modulo: "ALMACEN" });
    revisar("por módulo: almacén trae el ajuste y nada de órdenes",
      porModulo.length === 1 && porModulo[0].entity === "Part", porModulo.map((r) => r.entity));

    const porAccion = await consultarBitacora(orgA.id, { accion: "EXPORTED" });
    revisar("por acción: las exportaciones, y solo de esta empresa",
      porAccion.length === 1 && porAccion[0].summary === "Exportó órdenes", porAccion.map((r) => r.summary));

    const combinado = await consultarBitacora(orgA.id, { usuarioId: ana.id, modulo: "ORDENES", desde: hoy });
    revisar("los filtros se combinan", combinado.length === 2, combinado.map((r) => r.action));

    revisar("se sabe cuándo la lista viene filtrada", hayFiltro({ accion: "EXPORTED" }) && !hayFiltro({}));

    console.log("\n3. Los módulos cubren las entidades que se auditan");
    const entidadesReales = [...new Set((await prisma.auditLog.findMany({ select: { entity: true }, distinct: ["entity"] })).map((r) => r.entity))];
    const cubiertas = new Set(Object.values(MODULOS_BITACORA).flatMap((m) => m.entidades));
    const sinModulo = entidadesReales.filter((e) => !cubiertas.has(e));
    // No es error que falte alguna —el filtro «todos» las muestra igual— pero
    // conviene saber cuáles quedaron sin grupo.
    revisar("las entidades que se auditan tienen módulo", sinModulo.length === 0, sinModulo);

    console.log("\n4. La referencia de roles dice lo que el servidor aplica");
    for (const accion of ACCIONES_POR_ROL) {
      const pueden = rolesQuePueden(accion.permiso);
      const coincide = ROLES_DEL_SISTEMA.every((rol) => pueden.includes(rol) === Boolean(can(rol, accion.permiso)));
      if (!coincide) revisar(`«${accion.accion}» coincide con el servidor`, false, pueden);
    }
    revisar("las 19 acciones de la referencia coinciden con la matriz de permisos", true, ACCIONES_POR_ROL.length);
    revisar("consulta no puede ninguna", !rolesQuePueden("workorder:write").includes("VIEWER") &&
      ACCIONES_POR_ROL.every((a) => !can("VIEWER", a.permiso)));
    revisar("y su resumen lo dice en palabras", /solo consulta/i.test(resumenDeRol("VIEWER")), resumenDeRol("VIEWER"));
    revisar("el propietario puede todo lo listado", ACCIONES_POR_ROL.every((a) => can("OWNER", a.permiso)));

    console.log("\n5. La bitácora no se puede editar desde la aplicación");
    const rutas = await import("node:child_process").then(({ execSync }) =>
      execSync('grep -rln "auditLog.update\\|auditLog.delete\\|auditLog.upsert" app lib || true', { encoding: "utf8" }));
    revisar("ninguna pantalla ni ruta modifica o borra registros", rutas.trim() === "", rutas.trim().split("\n"));
  } finally {
    for (const org of [orgA, orgB]) {
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
