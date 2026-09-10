/**
 * Una solicitud que llega SIN equipo, y el gestor se lo pone al revisar.
 *
 * El caso: el gerente de produccion va caminando por la linea, ve un
 * componente tirando aceite, y no hay un QR cerca. Reporta desde su celular
 * describiendo lo que ve. Quien conoce el catalogo y puede decir de que equipo
 * se trata es el gestor, no el.
 *
 * El defecto: la revision no tenia donde poner el equipo. La solicitud se
 * convertia en una orden SIN ACTIVO, para siempre. Esa orden no entra al
 * expediente de ningun equipo, no cuenta en su Pareto y no suma a su costo de
 * paro. Se veia perfectamente normal y desaparecia del historial.
 *
 * La prueba llama a la MISMA funcion que la ruta —aprobarSolicitud()—, no una
 * copia de sus pasos. Una prueba que replica al endpoint no prueba nada: ya
 * paso con el alta de planes, donde la prueba asignaba por su cuenta, el
 * endpoint nunca asignaba, y las dos pasaban.
 *
 *   npx tsx scripts/prueba-solicitud-sin-equipo.ts
 */
import { prisma } from "../lib/db";
import { aprobarSolicitud, ErrorDeSolicitud } from "../lib/solicitudes";
import { nextRequestNumber } from "../lib/numbering";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-sin-eq-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const vecino = await prisma.organization.create({
    data: { name: `${sello}-vecino`, slug: `${sello}-vecino`, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({
    data: { organizationId: org.id, code: "PL", name: "Planta" },
  });
  const area = await prisma.location.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "NAVE", name: "Nave" },
  });
  const gestor = await prisma.user.create({
    data: {
      organizationId: org.id, email: `${sello}@x.mx`, name: "Gestor",
      passwordHash: "x", role: "ADMIN",
    },
  });
  const reductor = await prisma.asset.create({
    data: {
      organizationId: org.id, siteId: sitio.id, locationId: area.id,
      code: "RED-001", name: "Reductor de banda 3", status: "OPERATIONAL",
    },
  });
  // De otra empresa: no debe poderse asignar aunque se conozca su id.
  const sitioVecino = await prisma.site.create({
    data: { organizationId: vecino.id, code: "V", name: "Vecino" },
  });
  const ajeno = await prisma.asset.create({
    data: { organizationId: vecino.id, siteId: sitioVecino.id, code: "AJENO-1", name: "Ajeno" },
  });

  const nuevaSolicitud = async (titulo: string) =>
    prisma.workRequest.create({
      data: {
        organizationId: org.id,
        number: await nextRequestNumber(org.id),
        title: titulo,
        description: "Está tirando aceite por la parte de abajo.",
        priority: "HIGH",
        status: "PENDING",
        // Sin equipo: es como llega desde un QR de área o desde el celular.
        assetId: null,
      },
    });

  console.log("\nEl gestor le pone el equipo al revisar");
  const s1 = await nuevaSolicitud("Fuga de aceite en la línea");
  const r1 = await aprobarSolicitud({
    organizationId: org.id, userId: gestor.id, solicitudId: s1.id,
    assetId: reductor.id, tipo: "FALLA",
  });
  const ot1 = await prisma.workOrder.findUnique({
    where: { id: r1.workOrder.id },
    select: { assetId: true, siteId: true, locationId: true },
  });
  revisar("la orden queda con el equipo", ot1?.assetId === reductor.id);
  revisar("y hereda su sitio y su área, que la solicitud no traía",
    ot1?.siteId === sitio.id && ot1?.locationId === area.id);
  const s1Despues = await prisma.workRequest.findUnique({
    where: { id: s1.id }, select: { assetId: true },
  });
  revisar("la solicitud también conserva a qué equipo se refería",
    s1Despues?.assetId === reductor.id);
  const enExpediente = await prisma.workOrder.count({
    where: { organizationId: org.id, assetId: reductor.id },
  });
  revisar("y por lo tanto entra al expediente del equipo", enExpediente === 1);

  console.log("\nSi el gestor no lo pone, sigue sin equipo — no se inventa");
  const s2 = await nuevaSolicitud("Ruido en algún lado de la nave");
  const r2 = await aprobarSolicitud({
    organizationId: org.id, userId: gestor.id, solicitudId: s2.id, tipo: "FALLA",
  });
  const ot2 = await prisma.workOrder.findUnique({
    where: { id: r2.workOrder.id }, select: { assetId: true },
  });
  revisar("la orden queda sin equipo, y eso es correcto", ot2?.assetId === null);

  console.log("\nNo se puede asignar el equipo de otra empresa");
  const s3 = await nuevaSolicitud("Otro reporte");
  let rechazo: string | null = null;
  try {
    await aprobarSolicitud({
      organizationId: org.id, userId: gestor.id, solicitudId: s3.id, assetId: ajeno.id,
    });
  } catch (e) {
    rechazo = e instanceof ErrorDeSolicitud ? e.message : String(e);
  }
  revisar("se rechaza, y dice por qué", rechazo?.includes("no existe en su empresa") === true, rechazo ?? "no falló");
  const s3Despues = await prisma.workRequest.findUnique({
    where: { id: s3.id }, select: { status: true, workOrderId: true },
  });
  revisar("y la solicitud queda intacta, sin convertirse a medias",
    s3Despues?.status === "PENDING" && s3Despues?.workOrderId === null);

  console.log("\nEl equipo que ya traía no se pierde");
  const s4 = await prisma.workRequest.create({
    data: {
      organizationId: org.id, number: await nextRequestNumber(org.id),
      title: "Vino del QR del equipo", priority: "MEDIUM", status: "PENDING",
      assetId: reductor.id,
    },
  });
  // Sin pasar assetId: no debe borrarlo.
  const r4 = await aprobarSolicitud({
    organizationId: org.id, userId: gestor.id, solicitudId: s4.id, tipo: "FALLA",
  });
  const ot4 = await prisma.workOrder.findUnique({
    where: { id: r4.workOrder.id }, select: { assetId: true },
  });
  revisar("una solicitud que ya traía equipo lo conserva", ot4?.assetId === reductor.id);

  for (const o of [org.id, vecino.id]) {
    await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: o } } });
    await prisma.workRequest.deleteMany({ where: { organizationId: o } });
    await prisma.workOrder.deleteMany({ where: { organizationId: o } });
    await prisma.asset.deleteMany({ where: { organizationId: o } });
    await prisma.location.deleteMany({ where: { organizationId: o } });
    await prisma.site.deleteMany({ where: { organizationId: o } });
    await prisma.auditLog.deleteMany({ where: { organizationId: o } });
    await prisma.notification.deleteMany({ where: { organizationId: o } });
    await prisma.user.deleteMany({ where: { organizationId: o } });
    await prisma.organization.delete({ where: { id: o } });
  }

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
