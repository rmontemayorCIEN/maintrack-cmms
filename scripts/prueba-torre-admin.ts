/**
 * La administracion desde la Torre de Control: las rutas /api/torre/admin/*
 * con la firma de verdad (lib/torre/administracion.ts), que no salgan
 * nombres ni correos de personas, y que cada acceso quede en la bitacora del
 * operador a nombre de quien firmo.
 *
 *   npx tsx scripts/prueba-torre-admin.ts
 *
 * Usa la base de desarrollo y borra lo que crea.
 */
import { prisma } from "../lib/db";
import { firmar } from "../lib/torre/administracion";
import { GET as catalogo } from "../app/api/torre/admin/catalogo/route";
import { GET as lista } from "../app/api/torre/admin/cuentas/route";
import { GET as detalle } from "../app/api/torre/admin/cuentas/[id]/route";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${!bien && d ? ` · ${d.slice(0, 300)}` : ""}`);
  if (!bien) fallas++;
}

const SECRETO = "m".repeat(48);
const BASE = "https://maintrack.prueba";
const persona = { email: "rafael@torre.test", nombre: "Rafael" };
const pedir = (ruta: string, o: { secreto?: string; app?: string } = {}) =>
  new Request(BASE + ruta, { headers: { authorization: firmar(o.secreto ?? SECRETO, { app: o.app ?? "maintrack", persona, metodo: "GET", ruta }) } });

async function main() {
  const marca = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Torre prueba ${marca}`, slug: `torre-prueba-${marca}`, plan: "PROFESSIONAL", status: "TRIAL", trialEndsAt: new Date(Date.now() + 10 * 86_400_000) },
  });
  // El operador de la plataforma, en su propia cuenta interna (ahi se anota el acceso).
  const orgOperador = await prisma.organization.create({ data: { name: `Operador ${marca}`, slug: `torre-prueba-op-${marca}`, cuentaInterna: true } });
  await prisma.user.create({ data: { organizationId: orgOperador.id, email: `operador-${marca}@torre.test`, name: "Operador", passwordHash: "x", role: "OWNER", isSuperAdmin: true } });
  // Lo que deje una corrida que se cayo a la mitad.
  await prisma.organization.deleteMany({ where: { slug: { startsWith: "torre-prueba-" }, NOT: { id: { in: [org.id, orgOperador.id] } } } });
  const persona1 = await prisma.user.create({
    data: { organizationId: org.id, email: `privado-${marca}@cliente.test`, name: "Nombre Privado Cliente", passwordHash: "x", role: "OWNER" },
  });
  await prisma.invoice.create({
    data: { organizationId: org.id, folio: `T-${marca}`, periodo: "2026-10", plan: "PROFESSIONAL", importe: 4500, concepto: "Prueba de la Torre", venceEl: new Date(Date.now() - 86_400_000) },
  });

  try {
    console.log("\nSin firma, nadie pasa");
    delete process.env.TORRE_ADMIN_SECRETO;
    revisar("sin secreto configurado, 404", (await catalogo(pedir("/api/torre/admin/catalogo"))).status === 404);
    process.env.TORRE_ADMIN_SECRETO = SECRETO;
    revisar("sin firma, 404", (await catalogo(new Request(`${BASE}/api/torre/admin/catalogo`))).status === 404);
    revisar("con otro secreto, 404", (await catalogo(pedir("/api/torre/admin/catalogo", { secreto: "x".repeat(48) }))).status === 404);
    revisar("firmada para otra app, 404", (await catalogo(pedir("/api/torre/admin/catalogo", { app: "avisos" }))).status === 404);

    console.log("\nLo que contesta");
    const c = await (await catalogo(pedir("/api/torre/admin/catalogo"))).json();
    revisar("el catálogo dice cómo se llaman sus cuentas", c.cuentas?.plural === "empresas", c);
    const antes = await prisma.auditLog.count({ where: { action: "TORRE_ACCESS" } });
    const l = await lista(pedir("/api/torre/admin/cuentas"));
    const texto = await l.text();
    revisar("la lista contesta", l.status === 200, texto.slice(0, 200));
    const mia = JSON.parse(texto).cuentas?.find((x: { id: string }) => x.id === org.id);
    revisar("trae la empresa en prueba, con su fin de prueba", mia?.estado === "PRUEBA" && Boolean(mia?.pruebaHasta), mia);
    revisar("con su saldo pendiente en pesos", mia?.saldo === 4500 && mia?.moneda === "MXN", mia);
    revisar("no viajan correos ni nombres de personas", !texto.includes(persona1.email) && !texto.includes("Nombre Privado Cliente"));
    revisar("ver la lista queda en la bitácora", (await prisma.auditLog.count({ where: { action: "TORRE_ACCESS" } })) === antes + 1);

    console.log("\nEl detalle");
    const d = await detalle(pedir(`/api/torre/admin/cuentas/${org.id}`), { params: Promise.resolve({ id: org.id }) });
    const textoD = await d.text();
    revisar("el detalle contesta con adopción y cobranza", d.status === 200 && textoD.includes("Adopción") && textoD.includes("Cobranza"), textoD.slice(0, 200));
    revisar("sin correos ni nombres de personas", !textoD.includes(persona1.email) && !textoD.includes("Nombre Privado Cliente"));
    const ultimo = await prisma.auditLog.findFirst({ where: { action: "TORRE_ACCESS" }, orderBy: { createdAt: "desc" } });
    revisar("queda en la bitácora del operador, a nombre de quien firmó", ultimo?.entityId === org.id && (ultimo?.changes ?? "").includes("rafael@torre.test"), ultimo);
    const x = await detalle(pedir("/api/torre/admin/cuentas/no-existe-esta-org"), { params: Promise.resolve({ id: "no-existe-esta-org" }) });
    revisar("una empresa que no existe es 404", x.status === 404);
    const mal = await detalle(pedir("/api/torre/admin/cuentas/a'b"), { params: Promise.resolve({ id: "a'b" }) });
    revisar("un identificador mal formado es 404", mal.status === 404);

    console.log("\nSin operador donde anotar, el dato no sale");
    await prisma.user.updateMany({ where: { organizationId: orgOperador.id }, data: { isSuperAdmin: false } });
    const operadoresReales = await prisma.user.count({ where: { isSuperAdmin: true, active: true } });
    if (operadoresReales === 0) {
      const sin = await lista(pedir("/api/torre/admin/cuentas"));
      const t = await sin.text();
      revisar("contesta 500 sin detalles internos", sin.status === 500 && !t.includes("operador"), t);
    } else {
      revisar("(se omite: esta base tiene otros operadores)", true);
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { action: "TORRE_ACCESS", changes: { contains: "rafael@torre.test" } } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgOperador.id } });
    await prisma.user.deleteMany({ where: { organizationId: orgOperador.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgOperador.id] } } });
  }

  console.log(`\n${fallas ? `${fallas} FALLAS` : "todo en verde"}\n`);
  await prisma.$disconnect();
  process.exit(fallas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
