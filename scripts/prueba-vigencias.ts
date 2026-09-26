/**
 * Vigencias: garantias, polizas, contratos, calibraciones y permisos.
 *
 * Llama a las MISMAS funciones que las rutas (`guardarVigencia`,
 * `cambiarActivaVigencia`, `advertenciaDeGarantia`, `avisarVigencias`) y al
 * mismo proceso de reconciliacion que corre en produccion. Una prueba que
 * replicara los pasos del endpoint no probaria nada.
 *
 *   npx tsx scripts/prueba-vigencias.ts
 */
import { prisma } from "../lib/db";
import {
  ErrorDeVigencia, advertenciaDeGarantia, cambiarActivaVigencia, garantiaVigenteDe,
  guardarVigencia, listarVigencias, vigenciasDe, vigenciasQueVencen,
} from "../lib/vigencias";
import { TIPOS_VIGENCIA, diasParaVencer, estadoDeVigencia } from "../lib/vigencias-tipos";
import { avisarVigencias } from "../lib/avisos/detectores";
import { correrAvisos } from "../lib/avisos/proceso";
import { can } from "../lib/rbac";
import { puedeVerRuta } from "../lib/pantallas";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 260)}` : ""}`);
}
async function rechaza(afirmacion: string, fn: () => Promise<unknown>, contiene?: RegExp) {
  try { await fn(); revisar(afirmacion, false, "no se rechazó"); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, e instanceof ErrorDeVigencia && (!contiene || contiene.test(m)), m);
  }
}

const DIA = 86_400_000;
const enDias = (n: number) => new Date(Date.now() + n * DIA);

async function main() {
  const sello = `prueba-vig-${Date.now()}`;
  const A = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const B = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE" } });

  try {
    const admin = await prisma.user.create({
      data: { organizationId: A.id, email: `a@${sello}.mx`, name: "Admin", role: "ADMIN", passwordHash: "x" },
    });
    const tecnico = await prisma.user.create({
      data: { organizationId: A.id, email: `t@${sello}.mx`, name: "Técnico", role: "TECHNICIAN", passwordHash: "x" },
    });
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const equipo = await prisma.asset.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "TOR-1", name: "Torno CNC", criticality: "A" },
    });
    const otroEquipo = await prisma.asset.create({
      data: { organizationId: A.id, siteId: sitio.id, code: "BOM-1", name: "Bomba" },
    });
    const proveedor = await prisma.supplier.create({ data: { organizationId: A.id, name: "Haas México", rfc: "HAA930101AB1" } });

    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "SB", name: "Planta B" } });
    const equipoB = await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "TOR-1", name: "Torno de B" } });

    // ═══════════════════════════════════════════ 1-5 Alta y reglas
    console.log("\n1-5. Alta, anclaje y reglas");
    const garantia = await guardarVigencia({
      organizationId: A.id, userId: admin.id, tipo: "GARANTIA", titulo: "Garantía de fábrica",
      folio: "G-8841", desde: enDias(-300), hasta: enDias(120), cuelgaDe: { assetId: equipo.id },
      supplierId: proveedor.id, cubre: "Motor y tarjeta. No cubre consumibles.",
    });
    revisar("1. la garantía se registra colgada del equipo, con su proveedor y qué cubre",
      garantia.assetId === equipo.id && garantia.tipo === "GARANTIA" && garantia.supplierId === proveedor.id
      && garantia.cubre?.includes("No cubre consumibles") === true);

    const enElActivo = await prisma.asset.findUniqueOrThrow({ where: { id: equipo.id }, select: { warrantyExpiry: true } });
    revisar("2. la fecha del activo se refresca sola: es cache de la vigencia, no una segunda verdad",
      enElActivo.warrantyExpiry?.getTime() === garantia.hasta?.getTime(),
      { enElActivo: enElActivo.warrantyExpiry?.toISOString(), vigencia: garantia.hasta?.toISOString() });

    await rechaza("3. sin decir de qué cuelga se rechaza",
      () => guardarVigencia({ organizationId: A.id, userId: admin.id, tipo: "GARANTIA", titulo: "Suelta", hasta: enDias(10) }),
      /de qué cuelga/i);
    // `userId` de la firma es QUIEN captura; el anclaje a una persona tambien
    // se llama `userId`, asi que para probar «dos anclas» se usan assetId y
    // serviceId, que no chocan con el capturista.
    const servicio = await prisma.externalService.create({
      data: { organizationId: A.id, code: "SRV-1", name: "Servicio de balanceo" },
    });
    await rechaza("   y colgada de dos cosas a la vez, también",
      () => guardarVigencia({
        organizationId: A.id, userId: admin.id, tipo: "CONTRATO_SERVICIO", titulo: "Doble",
        hasta: enDias(10), cuelgaDe: { assetId: equipo.id, serviceId: servicio.id },
      }),
      /una sola cosa/i);
    await rechaza("4. contra un equipo de OTRA empresa: «no existe en esta empresa»",
      () => guardarVigencia({ organizationId: A.id, userId: admin.id, tipo: "GARANTIA", titulo: "Ajena", hasta: enDias(10), cuelgaDe: { assetId: equipoB.id } }),
      /no existe en esta empresa/i);
    await rechaza("5. con la fecha de fin antes de la de inicio, tampoco",
      () => guardarVigencia({ organizationId: A.id, userId: admin.id, tipo: "POLIZA_SEGURO", titulo: "Al revés", desde: enDias(30), hasta: enDias(10), cuelgaDe: { assetId: equipo.id } }),
      /anterior a la de inicio/i);
    await rechaza("   ni con un tipo inventado",
      () => guardarVigencia({ organizationId: A.id, userId: admin.id, tipo: "LO_QUE_SEA", titulo: "X", cuelgaDe: { assetId: equipo.id } }),
      /desconocido/i);

    // ═══════════════════════════════════════════ 6-9 La garantía en la orden
    console.log("\n6-9. La garantía salta donde vale dinero");
    const enGarantia = await garantiaVigenteDe(A.id, equipo.id);
    revisar("6. se sabe que el equipo está cubierto, y por quién", enGarantia?.supplier?.name === "Haas México");

    const correctiva = await advertenciaDeGarantia(A.id, equipo.id, "CORRECTIVE");
    revisar("7. al abrir una correctiva se advierte, con la fecha, el proveedor y el folio",
      Boolean(correctiva) && /garantía/i.test(correctiva!.texto) && correctiva!.texto.includes("Haas México")
      && correctiva!.texto.includes("G-8841"), correctiva?.texto);

    const preventiva = await advertenciaDeGarantia(A.id, equipo.id, "PREVENTIVE");
    revisar("8. en un preventivo NO se advierte: un engrasado programado no se le reclama al proveedor",
      preventiva === null);

    const sinGarantia = await advertenciaDeGarantia(A.id, otroEquipo.id, "CORRECTIVE");
    const sinEquipo = await advertenciaDeGarantia(A.id, null, "CORRECTIVE");
    revisar("9. un equipo sin garantía, o una orden sin equipo, no advierten nada",
      sinGarantia === null && sinEquipo === null);

    // La vencida no cubre: es la mitad del valor de todo esto.
    const vencida = await guardarVigencia({
      organizationId: A.id, userId: admin.id, tipo: "GARANTIA", titulo: "Garantía vieja",
      hasta: enDias(-10), cuelgaDe: { assetId: otroEquipo.id },
    });
    revisar("   y una garantía YA VENCIDA tampoco: no hay a quién reclamarle",
      (await advertenciaDeGarantia(A.id, otroEquipo.id, "CORRECTIVE")) === null
      && estadoDeVigencia(vencida) === "VENCIDA");

    // ═══════════════════════════════════════════ 10-13 Estados y avisos
    console.log("\n10-13. Lo que vence, y el aviso que se cierra solo");
    const porVencer = await guardarVigencia({
      organizationId: A.id, userId: admin.id, tipo: "CALIBRACION", titulo: "Calibración del manómetro",
      hasta: enDias(10), cuelgaDe: { assetId: equipo.id },
    });
    const lejana = await guardarVigencia({
      organizationId: A.id, userId: admin.id, tipo: "PERMISO", titulo: "Permiso de caldera",
      hasta: enDias(300), cuelgaDe: { assetId: equipo.id },
    });
    const sinCaducar = await guardarVigencia({
      organizationId: A.id, userId: admin.id, tipo: "CERTIFICADO", titulo: "Certificado de fábrica",
      cuelgaDe: { assetId: equipo.id },
    });
    revisar("10. el estado se calcula: por vencer dentro del plazo de su tipo, vigente si falta más, sin vencimiento si no caduca",
      estadoDeVigencia(porVencer) === "POR_VENCER" && estadoDeVigencia(lejana) === "VIGENTE"
      && estadoDeVigencia(sinCaducar) === "SIN_VENCIMIENTO",
      { cal: estadoDeVigencia(porVencer), permiso: estadoDeVigencia(lejana), cert: estadoDeVigencia(sinCaducar) });
    revisar("    y cada tipo usa su propia anticipación, no una sola para todo",
      TIPOS_VIGENCIA.POLIZA_SEGURO.avisarDias === 60 && TIPOS_VIGENCIA.CALIBRACION.avisarDias === 30
      && diasParaVencer(porVencer.hasta) === 10);

    const vencen = await vigenciasQueVencen(A.id);
    revisar("11. «lo que vence» trae la por vencer y la vencida, no la lejana ni la que no caduca",
      vencen.some((v) => v.id === porVencer.id) && vencen.some((v) => v.id === vencida.id)
      && !vencen.some((v) => v.id === lejana.id) && !vencen.some((v) => v.id === sinCaducar.id),
      vencen.map((v) => `${v.titulo}:${v.estado}`));

    const emitidos = await avisarVigencias(A.id);
    const avisos = await prisma.notification.findMany({
      where: { organizationId: A.id, tipo: { in: ["VIGENCIA_POR_VENCER", "VIGENCIA_VENCIDA"] } },
      select: { tipo: true, entidadId: true, title: true, atendidaEl: true },
    });
    revisar("12. se emite un aviso POR DOCUMENTO, y distingue por vencer de vencida",
      avisos.some((a) => a.tipo === "VIGENCIA_POR_VENCER" && a.entidadId === porVencer.id)
      && avisos.some((a) => a.tipo === "VIGENCIA_VENCIDA" && a.entidadId === vencida.id),
      { emitidos, avisos: avisos.map((a) => `${a.tipo}:${a.title}`) });

    // La renovación: se registra la nueva y la vieja se queda como historia.
    await guardarVigencia({
      organizationId: A.id, userId: admin.id, tipo: "CALIBRACION", titulo: "Calibración del manómetro 2027",
      hasta: enDias(380), cuelgaDe: { assetId: equipo.id },
    });
    await correrAvisos({ organizationId: A.id });
    const trasRenovar = await prisma.notification.findFirstOrThrow({
      where: { organizationId: A.id, tipo: "VIGENCIA_POR_VENCER", entidadId: porVencer.id },
      select: { atendidaEl: true, atendidaMotivo: true },
    });
    revisar("13. al registrar otra del mismo tipo que cubre más lejos, el aviso se cierra SOLO",
      trasRenovar.atendidaEl !== null && /más lejos|Renov/i.test(trasRenovar.atendidaMotivo ?? ""),
      { atendida: trasRenovar.atendidaEl !== null, motivo: trasRenovar.atendidaMotivo });

    // ═══════════════════════════════════════════ 14-16 Cancelar, listar, permisos
    console.log("\n14-16. Cancelar, expediente y permisos");
    await cambiarActivaVigencia({ organizationId: A.id, userId: admin.id, id: vencida.id, activa: false });
    await correrAvisos({ organizationId: A.id });
    const trasCancelar = await prisma.notification.findFirstOrThrow({
      where: { organizationId: A.id, tipo: "VIGENCIA_VENCIDA", entidadId: vencida.id },
      select: { atendidaEl: true, atendidaMotivo: true },
    });
    const sigueEnLaBase = await prisma.vigencia.findUniqueOrThrow({ where: { id: vencida.id }, select: { activa: true, canceladaEl: true } });
    revisar("14. cancelar cierra su aviso y NO borra: la vigencia se queda como historia",
      trasCancelar.atendidaEl !== null && sigueEnLaBase.activa === false && sigueEnLaBase.canceladaEl !== null
      && estadoDeVigencia(sigueEnLaBase as never) === "CANCELADA",
      { atendida: trasCancelar.atendidaEl !== null, motivo: trasCancelar.atendidaMotivo });

    const delEquipo = await vigenciasDe(A.id, { assetId: equipo.id });
    const todas = await listarVigencias(A.id);
    const deB = await listarVigencias(B.id);
    revisar("15. el expediente del equipo trae solo lo suyo, y una empresa no ve lo de otra",
      delEquipo.length === 5 && delEquipo.every((v) => v.asset?.id === equipo.id)
      && todas.length === 6 && deB.length === 0,
      { delEquipo: delEquipo.length, todas: todas.length, deB: deB.length });

    revisar("16. capturar es de administración y supervisión; el técnico VE la pantalla pero no escribe",
      can("ADMIN", "vigencia:write") && can("SUPERVISOR", "vigencia:write")
      && !can("TECHNICIAN", "vigencia:write") && !can("REQUESTER", "vigencia:write")
      && !can("VIEWER", "vigencia:write")
      && puedeVerRuta("TECHNICIAN", "/vigencias") && puedeVerRuta("COMPRAS", "/vigencias")
      && !puedeVerRuta("REQUESTER", "/vigencias"),
      { tecnicoVe: puedeVerRuta("TECHNICIAN", "/vigencias"), tecnicoEscribe: can("TECHNICIAN", "vigencia:write") });

  } finally {
    for (const id of [A.id, B.id]) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(fallos ? `\n✗ ${fallos} fallas` : "\n✓ Las vigencias avisan, se cierran solas y la garantía salta donde importa");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
