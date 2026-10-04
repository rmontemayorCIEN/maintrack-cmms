/**
 * El ciclo de materiales por la RUTA de verdad: sesión, permisos y validaciones.
 *
 * `prueba-materiales.ts` llama a las funciones de `lib/`. Esta prueba levanta
 * la aplicacion, firma una sesion por rol y llama a `/api/requisiciones` y
 * `/api/compras` como lo hace el navegador: asi se prueba lo que la ruta
 * agrega —permisos, pertenencia de la actividad a la orden, aislamiento.
 *
 *   npx tsx scripts/prueba-http-materiales.ts
 *   BASE_URL=http://localhost:3000 npx tsx scripts/prueba-http-materiales.ts
 *
 * No debe correr al mismo tiempo que `npm run build` (comparten .next).
 */
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { aplicarMovimiento } from "../lib/almacen";
import { apagarServidor, levantarServidor } from "./servidor-de-prueba";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}` : ""}`);
}

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}

async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
      if (r.status < 500) return;
    } catch { /* todavia no levanta */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3196";
  if (!process.env.BASE_URL) {
    servidor = levantarServidor({ puerto: 3196 });
  }

  const sello = `prueba-http-mat-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", montoAutorizacion: 1000 },
  });
  const orgB = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE" } });

  try {
    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(llaveDeSesion());
    const sesion = async (organizationId: string, rol: string, nombre: string) => {
      const u = await prisma.user.create({
        data: { organizationId, email: `${nombre}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x" },
      });
      const token = await new SignJWT({ userId: u.id, organizationId, email: u.email, name: u.name, role: rol })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto);
      return { id: u.id, cookie: `mt_session=${token}` };
    };
    const jefe = await sesion(org.id, "ADMIN", "Jefa");
    const tecnico = await sesion(org.id, "TECHNICIAN", "Tecnico");
    const solicitante = await sesion(org.id, "REQUESTER", "Solicitante");
    const consulta = await sesion(org.id, "VIEWER", "Consulta");
    const ajeno = await sesion(orgB.id, "ADMIN", "AdminB");

    const almacen = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
    // La otra empresa también tiene almacén: así su intento llega hasta la
    // revisión de la orden y se prueba el aislamiento de verdad, no la falta
    // de almacén.
    await prisma.warehouse.create({ data: { organizationId: orgB.id, code: "GEN", name: "General B", esGeneral: true } });
    const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "PL", name: "Planta" } });
    const activo = await prisma.asset.create({ data: { organizationId: org.id, siteId: sitio.id, code: "BOM-1", name: "Bomba", status: "OPERATIONAL" } });
    const parte = await prisma.part.create({ data: { organizationId: org.id, code: "ROD-9", name: "Rodamiento", unit: "pza", unitCost: 100 } });
    await aplicarMovimiento({ organizationId: org.id, partId: parte.id, warehouseId: almacen.id, tipo: "IN", cantidad: 5, costoUnitario: 100, userId: jefe.id });

    const ot = await prisma.workOrder.create({
      data: { organizationId: org.id, number: "OT-HM1", title: "Preventivo con falla", assetId: activo.id, maintenanceType: "PREVENTIVE", status: "IN_PROGRESS", startedAt: new Date(), assignedToId: tecnico.id },
    });
    const actPrev = await prisma.workOrderTask.create({ data: { workOrderId: ot.id, title: "Engrase", maintenanceType: "PREVENTIVE", position: 0 } });
    const actCorr = await prisma.workOrderTask.create({ data: { workOrderId: ot.id, title: "Cambio de sello por fuga", maintenanceType: "CORRECTIVE", position: 1 } });
    const liberada = await prisma.workOrderTask.create({
      data: { workOrderId: ot.id, title: "No se pudo", position: 2, liberadaAt: new Date(), motivoLiberacion: "SIN_REFACCION" },
    });
    const otraOt = await prisma.workOrder.create({
      data: { organizationId: org.id, number: "OT-HM2", title: "Otra", maintenanceType: "CORRECTIVE", status: "OPEN" },
    });
    const actAjena = await prisma.workOrderTask.create({ data: { workOrderId: otraOt.id, title: "De otra orden", position: 0 } });

    const pedir = async (quien: { cookie: string }, cuerpo: Record<string, unknown>) => {
      const r = await fetch(`${base}/api/requisiciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: quien.cookie },
        body: JSON.stringify({ workOrderId: ot.id, urgencia: "NORMAL", ...cuerpo }),
        signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, cuerpo: await r.json().catch(() => null) as { error?: string; id?: string } | null };
    };
    const renglon = (taskId: string | null, cantidad = 1) => ({
      partId: parte.id, descripcion: "ROD-9 rodamiento", cantidadSolicitada: cantidad, taskId,
    });

    console.log("\n1. La actividad de cada renglón la valida el servidor");
    let r = await pedir(jefe, { renglones: [renglon(actAjena.id)] });
    revisar("una actividad de otra orden → 422", r.status === 422 && /no es de esa orden/.test(r.cuerpo?.error ?? ""), r);
    r = await pedir(jefe, { renglones: [renglon(liberada.id)] });
    revisar("una actividad enviada al backlog → 422", r.status === 422 && /backlog/.test(r.cuerpo?.error ?? ""), r);
    r = await pedir(jefe, { renglones: [renglon("no-existe")] });
    revisar("una actividad inventada → 422", r.status === 422, r.status);

    console.log("\n2. La clasificación sale de la actividad, no del formulario");
    r = await pedir(jefe, {
      motivo: "MINIMO",
      renglones: [renglon(actPrev.id, 1), renglon(actCorr.id, 1), renglon(null, 1)],
    });
    revisar("se crea con renglones de dos actividades y uno general", r.status === 201, r.status);
    const creada = await prisma.materialRequest.findUniqueOrThrow({
      where: { id: r.cuerpo!.id! }, include: { renglones: { include: { task: true } } },
    });
    revisar("el motivo del encabezado dice «varios tipos» aunque el formulario mandó «mínimo»", creada.motivo === "MIXTA", creada.motivo);
    revisar("cada renglón guarda su actividad; el general queda sin ninguna",
      creada.renglones.filter((x) => x.taskId === actPrev.id).length === 1 &&
      creada.renglones.filter((x) => x.taskId === actCorr.id).length === 1 &&
      creada.renglones.filter((x) => x.taskId === null).length === 1);

    const soloPreventivo = await pedir(jefe, { renglones: [renglon(actPrev.id, 1)] });
    revisar("un vale solo de la actividad preventiva se clasifica preventivo",
      (await prisma.materialRequest.findUniqueOrThrow({ where: { id: soloPreventivo.cuerpo!.id! } })).motivo === "PREVENTIVO");

    console.log("\n3. Permisos y aislamiento en el servidor");
    r = await pedir(solicitante, { renglones: [renglon(actPrev.id)] });
    revisar("el solicitante sí puede pedir material", r.status === 201, r.status);
    r = await pedir(consulta, { renglones: [renglon(actPrev.id)] });
    revisar("una cuenta de consulta no puede pedir → 403", r.status === 403, r);
    const surtirComo = async (quien: { cookie: string }, requestId: string, lineId: string) => {
      const res = await fetch(`${base}/api/requisiciones/${requestId}`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: quien.cookie },
        body: JSON.stringify({ accion: "SURTIR", entregadoA: "Miguel", renglones: [{ lineId, cantidad: 1 }] }),
        signal: AbortSignal.timeout(120_000),
      });
      return { status: res.status, cuerpo: await res.json().catch(() => null) as { error?: string } | null };
    };
    const linea = creada.renglones.find((x) => x.taskId === actPrev.id)!;
    let s2 = await surtirComo(solicitante, creada.id, linea.id);
    revisar("quien pide no surte: el solicitante no puede entregar material → 403", s2.status === 403, s2);
    s2 = await surtirComo(ajeno, creada.id, linea.id);
    revisar("otra empresa no puede surtir ese vale", s2.status === 422 || s2.status === 404, s2);
    s2 = await surtirComo(tecnico, creada.id, linea.id);
    revisar("el técnico de almacén sí surte", s2.status === 200, s2);
    const cargo = await prisma.workOrderPart.findFirstOrThrow({ where: { workOrderId: ot.id } });
    revisar("y el cargo queda en la actividad preventiva, con su costo", cargo.taskId === actPrev.id && cargo.cost === 100);

    r = await pedir(ajeno, { renglones: [renglon(actPrev.id)] });
    revisar("otra empresa no puede pedir contra esta orden", r.status === 404, r);
  } finally {
    for (const id of [org.id, orgB.id]) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    await apagarServidor(servidor, 3196);
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
