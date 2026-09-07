/**
 * Donde espera el sistema a que alguien se asome.
 *
 * El valor de un canal como WhatsApp no es "mandar avisos": es COMPRIMIR UNA
 * ESPERA. Asi que la pregunta no es que se puede notificar, sino donde hay
 * hoy un dato listo que nadie esta viendo, y cuanto tiempo se pierde ahi.
 *
 * Solo lee. Contra produccion:
 *   ./scripts/con-produccion.sh scripts/diagnostico-esperas.ts
 */
import { prisma } from "../lib/db";

const HORAS = 3_600_000;
const DIAS = 86_400_000;

function horas(ms: number) {
  return Math.round(ms / HORAS * 10) / 10;
}
function mediana(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  // Solo cuentas con actividad de verdad: las de prueba llenan la pantalla de
  // "sin esperas medibles" y esconden lo que importa.
  const todas = await prisma.organization.findMany({
    where: { workOrders: { some: {} } },
    select: { id: true, name: true, _count: { select: { workOrders: true, assets: true } } },
  });
  const orgs = todas.filter((o) => o._count.workOrders >= 5 && o._count.assets >= 3);
  if (todas.length > orgs.length) {
    console.log(`(se omiten ${todas.length - orgs.length} cuentas con poca actividad)`);
  }

  console.log("");
  console.log("DONDE SE PIERDE TIEMPO HOY");
  console.log("Se mide la espera real, no la que uno supone.\n");

  for (const org of orgs) {
    const [reportes, correctivas, backlog, vencidas, alertas, bajoMinimo] = await Promise.all([
      // 1. Un reporte levantado, esperando que alguien lo revise.
      prisma.workRequest.findMany({
        where: { organizationId: org.id, reviewedAt: { not: null } },
        select: { createdAt: true, reviewedAt: true },
      }),
      // 2. Una OT correctiva creada, esperando que alguien la empiece.
      prisma.workOrder.findMany({
        where: { organizationId: org.id, maintenanceType: "CORRECTIVE", startedAt: { not: null } },
        select: { createdAt: true, startedAt: true },
      }),
      // 3. Trabajo trabado por falta de refaccion.
      prisma.workOrderTask.findMany({
        where: {
          liberadaAt: { not: null }, retomadaPor: null,
          motivoLiberacion: "SIN_REFACCION",
          workOrder: { organizationId: org.id },
        },
        select: { liberadaAt: true, bloqueadaPorPartId: true },
      }),
      // 4. Ordenes que ya pasaron su fecha y siguen abiertas.
      prisma.workOrder.findMany({
        where: {
          organizationId: org.id,
          status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
          dueDate: { lt: new Date() },
        },
        select: { dueDate: true, priority: true },
      }),
      // 5. Alertas predictivas sin atender.
      prisma.predictiveAlert.findMany({
        where: { organizationId: org.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        select: { createdAt: true, severity: true },
      }),
      // 6. Refacciones bajo el minimo.
      prisma.part.count({
        where: { organizationId: org.id, active: true, minQuantity: { gt: 0 } },
      }),
    ]);

    const esperaRevision = reportes
      .filter((r) => r.reviewedAt)
      .map((r) => r.reviewedAt!.getTime() - r.createdAt.getTime());
    const esperaArranque = correctivas
      .map((w) => w.startedAt!.getTime() - w.createdAt.getTime());

    // Cuales de las trabadas YA SE PUEDEN hacer: la refaccion ya esta.
    const partIds = backlog.map((b) => b.bloqueadaPorPartId).filter(Boolean) as string[];
    const conExistencia = partIds.length
      ? await prisma.part.findMany({
          where: { id: { in: partIds }, quantityOnHand: { gt: 0 } },
          select: { id: true },
        })
      : [];
    const listas = backlog.filter(
      (b) => b.bloqueadaPorPartId && conExistencia.some((p) => p.id === b.bloqueadaPorPartId),
    );

    console.log(`── ${org.name} ──`);

    if (esperaRevision.length) {
      console.log(`  Un reporte espera revision:      ${horas(mediana(esperaRevision))} h (mediana de ${esperaRevision.length})`);
    }
    if (esperaArranque.length) {
      console.log(`  Una correctiva espera arranque:  ${horas(mediana(esperaArranque))} h (mediana de ${esperaArranque.length})`);
    }
    if (listas.length) {
      const espera = listas.map((b) => Date.now() - b.liberadaAt!.getTime());
      console.log(`  YA SE PUEDEN hacer y nadie sabe:  ${listas.length} actividad(es), llevan ${Math.round(mediana(espera) / DIAS)} dias esperando`);
    }
    if (vencidas.length) {
      const criticas = vencidas.filter((w) => ["HIGH", "CRITICAL"].includes(w.priority)).length;
      console.log(`  Ordenes vencidas y abiertas:      ${vencidas.length}${criticas ? `, ${criticas} de prioridad alta` : ""}`);
    }
    if (alertas.length) {
      const espera = alertas.map((a) => Date.now() - a.createdAt.getTime());
      console.log(`  Alertas predictivas sin atender:  ${alertas.length}, la mediana lleva ${Math.round(mediana(espera) / DIAS)} dias`);
    }
    if (!esperaRevision.length && !esperaArranque.length && !listas.length && !vencidas.length && !alertas.length) {
      console.log("  Sin esperas medibles todavia.");
    }
    void bajoMinimo;
    console.log("");
  }

  console.log("COMO LEER ESTO");
  console.log("  Cada hora de esas es tiempo en que el dato YA existia en el");
  console.log("  sistema y nadie lo estaba viendo. Eso es lo que un aviso por");
  console.log("  WhatsApp puede recortar. Lo demas —numeros, reportes, graficas—");
  console.log("  no gana nada por llegar al telefono.");
  console.log("");
}

main().finally(() => prisma.$disconnect());
