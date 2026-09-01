/**
 * Prueba del portal publico. Es la unica ruta que escribe sin sesion, asi que
 * lo que se verifica es el aislamiento: que la organizacion salga del token,
 * que el limite de frecuencia funcione, y que una liga de seguimiento no
 * revele mas que su propia solicitud.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDePortal, contextoDelPunto, crearPuntoDeReporte, levantarSolicitud, recuperarSeguimiento, seguimientoDe } from "../lib/portal";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(56)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esp)})`}`);
}
async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "paso"; } catch (e) { return e instanceof ErrorDePortal ? "rechazado" : `error: ${(e as Error).message}`; }
}

async function main() {
  // Dos empresas, para comprobar que una no alcanza a la otra.
  const a = await prisma.organization.create({ data: { name: "Plaza Norte", slug: `pn-${Date.now()}` } });
  const b = await prisma.organization.create({ data: { name: "Escuela Sur", slug: `es-${Date.now()}` } });
  const admin = await prisma.user.create({ data: { organizationId: a.id, email: `a${Date.now()}@x.com`, name: "Admin", passwordHash: "x", role: "ADMIN" } });
  await prisma.user.create({ data: { organizationId: b.id, email: `b${Date.now()}@x.com`, name: "Otro", passwordHash: "x", role: "ADMIN" } });

  const sitioA = await prisma.site.create({ data: { organizationId: a.id, code: "S1", name: "Torre A" } });
  const ubiA = await prisma.location.create({ data: { organizationId: a.id, siteId: sitioA.id, code: "L1", name: "Local 12" } });
  const equipoA = await prisma.asset.create({ data: { organizationId: a.id, siteId: sitioA.id, code: "ACT-9", name: "Minisplit" } });
  const sitioB = await prisma.site.create({ data: { organizationId: b.id, code: "S1", name: "Primaria" } });

  console.log("\nAISLAMIENTO\n");
  revisar("no se puede colgar un QR de un sitio de OTRA empresa",
    await intentar(() => crearPuntoDeReporte({ organizationId: a.id, userId: admin.id, nombre: "Trampa", siteId: sitioB.id })),
    "rechazado");

  const punto = await crearPuntoDeReporte({
    organizationId: a.id, userId: admin.id, nombre: "Local 12",
    siteId: sitioA.id, locationId: ubiA.id, assetId: equipoA.id,
  });
  const ctx = await contextoDelPunto(punto.token);
  revisar("el contexto sale del token", `${ctx!.organizationId === a.id}:${ctx!.asset?.code}`, "true:ACT-9");
  revisar("un token inventado no devuelve nada", await contextoDelPunto("noexiste123456789"), null);

  console.log("\nREPORTE\n");
  const r = await levantarSolicitud({
    tokenPunto: punto.token, titulo: "El aire no enfria",
    descripcion: "Desde el lunes", nombre: "Ana Robles", celular: "81 1234 5678",
  });
  revisar("el folio es de la serie SS", r.numero.slice(0, 3), "SS-");

  const creada = await prisma.workRequest.findFirst({
    where: { number: r.numero },
    select: { organizationId: true, assetId: true, siteId: true, locationId: true, status: true, reporterNombre: true },
  });
  revisar("quedo en la empresa del token", creada!.organizationId === a.id, true);
  revisar("hereda el equipo del QR sin que nadie lo eligiera", creada!.assetId === equipoA.id, true);
  revisar("hereda sitio y ubicacion", `${creada!.siteId === sitioA.id}:${creada!.locationId === ubiA.id}`, "true:true");
  revisar("cae en revision, NO se vuelve orden sola", creada!.status, "PENDING");
  revisar("guarda quien reporto", creada!.reporterNombre, "Ana Robles");
  revisar("se aviso a mantenimiento de esa empresa",
    await prisma.notification.count({ where: { organizationId: a.id } }), 1);
  revisar("la otra empresa no se entero",
    await prisma.notification.count({ where: { organizationId: b.id } }), 0);

  console.log("\nLIMITE DE FRECUENCIA\n");
  for (let i = 0; i < 9; i++) {
    await levantarSolicitud({ tokenPunto: punto.token, titulo: `Reporte de prueba ${i}`, nombre: "Ana Robles", celular: "8112345678" });
  }
  revisar("el reporte 11 en diez minutos se rechaza",
    await intentar(() => levantarSolicitud({ tokenPunto: punto.token, titulo: "Uno mas de mas", nombre: "Ana", celular: "8112345678" })),
    "rechazado");
  revisar("quedaron 10, no 11", await prisma.workRequest.count({ where: { reportPointId: punto.id } }), 10);

  console.log("\nSEGUIMIENTO\n");
  const s = await seguimientoDe(r.seguimiento);
  revisar("la liga muestra su solicitud", s!.number, r.numero);
  revisar("una liga inventada no muestra nada", await seguimientoDe("inventada000000000000"), null);

  revisar("recuperar con folio y celular correctos", (await recuperarSeguimiento(r.numero, "81 1234 5678")) === r.seguimiento, true);
  revisar("el celular con otro formato tambien sirve", (await recuperarSeguimiento(r.numero, "8112345678")) === r.seguimiento, true);
  revisar("folio correcto con celular equivocado no devuelve nada", await recuperarSeguimiento(r.numero, "8199999999"), null);
  revisar("folio inventado no devuelve nada", await recuperarSeguimiento("SS-999999", "8112345678"), null);

  console.log("\nPUNTO DESACTIVADO\n");
  await prisma.reportPoint.update({ where: { id: punto.id }, data: { activo: false } });
  revisar("un QR desactivado deja de recibir",
    await intentar(() => levantarSolicitud({ tokenPunto: punto.token, titulo: "Ya no deberia entrar", nombre: "Ana", celular: "8112345678" })),
    "rechazado");

  for (const org of [a, b]) {
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { organizationId: org.id } }),
      prisma.workRequest.deleteMany({ where: { organizationId: org.id } }),
      prisma.reportPoint.deleteMany({ where: { organizationId: org.id } }),
      prisma.asset.deleteMany({ where: { organizationId: org.id } }),
      prisma.location.deleteMany({ where: { organizationId: org.id } }),
      prisma.site.deleteMany({ where: { organizationId: org.id } }),
      prisma.user.deleteMany({ where: { organizationId: org.id } }),
      prisma.organization.delete({ where: { id: org.id } }),
    ]);
  }
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
