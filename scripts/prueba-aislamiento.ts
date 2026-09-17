/**
 * Bloque 3 — Aislamiento entre empresas, probado contra el SERVIDOR.
 *
 * La pregunta que responde es una sola: si alguien de la empresa B conoce el
 * identificador de un registro de la empresa A —porque lo vio, porque lo
 * adivino, porque se lo pasaron— ¿el servidor se lo entrega?
 *
 * Por eso NO llama a las funciones de `lib/`: llama a las rutas, con una sesion
 * firmada igual que la del navegador. Un filtro que existe en la funcion pero
 * que la ruta no aplica, aqui se ve.
 *
 *   npx tsx scripts/prueba-aislamiento.ts
 *   BASE_URL=http://localhost:3000 npx tsx scripts/prueba-aislamiento.ts
 *
 * No debe correr al mismo tiempo que `npm run build` (comparten .next).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

/** La llave de sesion del entorno local, sin imprimirla nunca. */
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

/** Lo que se considera «bien rechazado»: no encontrado, o sin permiso. */
const RECHAZO = [400, 401, 403, 404, 409, 422];

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3198";
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", "3198", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `aisl-${Date.now()}`;
  const secreto = new TextEncoder().encode(llaveDeSesion());
  const orgA = await prisma.organization.create({
    data: { name: `${sello}-A`, slug: `${sello}-a`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });
  const orgB = await prisma.organization.create({
    data: { name: `${sello}-B`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });

  const sesionDe = async (userId: string, organizationId: string, email: string, name: string, role: string) =>
    `mt_session=${await new SignJWT({ userId, organizationId, email, name, role })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;

  try {
    await esperarServidor(base, 240_000);

    // ── Fixtures: la empresa A con datos de todo el sistema ──────────────
    const dueñoA = await prisma.user.create({
      data: { organizationId: orgA.id, email: `a-${sello}@t.mx`, name: "Dueña A", role: "OWNER", passwordHash: "x" },
    });
    const dueñoB = await prisma.user.create({
      data: { organizationId: orgB.id, email: `b-${sello}@t.mx`, name: "Dueño B", role: "OWNER", passwordHash: "x" },
    });
    const cookieA = await sesionDe(dueñoA.id, orgA.id, dueñoA.email, dueñoA.name, "OWNER");
    const cookieB = await sesionDe(dueñoB.id, orgB.id, dueñoB.email, dueñoB.name, "OWNER");

    const sitioA = await prisma.site.create({ data: { organizationId: orgA.id, code: "SIT-A", name: "Planta A" } });
    const activoA = await prisma.asset.create({
      data: { organizationId: orgA.id, code: "ACT-A1", name: "Bomba de A", siteId: sitioA.id, criticality: "HIGH" },
    });
    const otA = await prisma.workOrder.create({
      data: { organizationId: orgA.id, number: "OT-A1", title: "Orden de A", assetId: activoA.id, status: "IN_PROGRESS", startedAt: new Date(), assignedToId: dueñoA.id },
    });
    const actividadA = await prisma.workOrderTask.create({
      data: { workOrderId: otA.id, title: "Actividad de A", position: 0 },
    });
    const solicitudA = await prisma.workRequest.create({
      data: { organizationId: orgA.id, number: "SOL-A1", title: "Solicitud de A", status: "PENDING", assetId: activoA.id },
    });
    const almacenA = await prisma.warehouse.create({ data: { organizationId: orgA.id, name: "Almacen A", code: "ALM-A" } });
    const refaccionA = await prisma.part.create({
      data: { organizationId: orgA.id, code: "REF-A1", name: "Refacción de A", unit: "pza", unitCost: 100, quantityOnHand: 5 },
    });
    await prisma.partStock.create({ data: { organizationId: orgA.id, partId: refaccionA.id, warehouseId: almacenA.id, quantity: 5 } });
    const proveedorA = await prisma.supplier.create({ data: { organizationId: orgA.id, name: "Proveedor de A" } });
    const planA = await prisma.maintenancePlan.create({
      data: { organizationId: orgA.id, name: "Plan de A", intervalDays: 30, nextDueDate: new Date(), assetId: activoA.id },
    });
    const valeA = await prisma.materialRequest.create({
      data: {
        organizationId: orgA.id, folio: "RM-A1", warehouseId: almacenA.id, workOrderId: otA.id, solicitanteId: dueñoA.id, motivo: "CORRECTIVO",
        renglones: { create: [{ partId: refaccionA.id, descripcion: "REF-A1", cantidadSolicitada: 1 }] },
      },
      include: { renglones: true },
    });
    const compraA = await prisma.purchaseRequest.create({
      data: { organizationId: orgA.id, folio: "RC-A1", warehouseId: almacenA.id, solicitanteId: dueñoA.id, urgencia: "NORMAL", montoEstimado: 100, estado: "SOLICITADA" },
    });
    const adjuntoA = await prisma.attachment.create({
      data: {
        organizationId: orgA.id, workOrderId: otA.id, name: "evidencia-de-A.jpg", storagePath: `org-${orgA.id}/wo/secreto.jpg`,
        mimeType: "image/jpeg", size: 1024, kind: "PHOTO", uploadedById: dueñoA.id,
      },
    });
    const medidorA = await prisma.meter.create({
      data: { organizationId: orgA.id, assetId: activoA.id, name: "Horómetro de A", unit: "h", currentValue: 10 },
    });
    const ligaA = await prisma.referenceLink.create({
      data: { organizationId: orgA.id, assetId: activoA.id, title: "Manual de A", url: "https://ejemplo.mx/manual" },
    });
    const puntoA = await prisma.reportPoint.create({
      data: { organizationId: orgA.id, token: `pt-${sello}`, nombre: "Punto de A", assetId: activoA.id },
    });

    // La empresa B existe de verdad: tiene su almacen, para que los rechazos no
    // sean por falta de datos suyos sino por ser ajenos los de A.
    await prisma.warehouse.create({ data: { organizationId: orgB.id, name: "Almacen B", code: "ALM-B" } });

    const pedir = async (metodo: string, ruta: string, cookie: string | null, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, texto: await r.text(), ubicacion: r.headers.get("location") };
    };

    // ── 1. Lectura y escritura cruzada, ruta por ruta ────────────────────
    console.log("\n1. La empresa B pide registros de la empresa A por su identificador");
    const cruces: Array<[string, string, string, unknown?]> = [
      ["orden de trabajo", "GET", `/api/work-orders/${otA.id}`],
      ["orden de trabajo (editar)", "PATCH", `/api/work-orders/${otA.id}`, { title: "secuestrada" }],
      ["cambio de estado de la orden", "POST", `/api/work-orders/${otA.id}/status`, { status: "COMPLETED" }],
      ["comentario en la orden", "POST", `/api/work-orders/${otA.id}/comments`, { body: "entré" }],
      ["mano de obra en la orden", "POST", `/api/work-orders/${otA.id}/labor`, { userId: dueñoA.id, hours: 1 }],
      ["refacción en la orden", "POST", `/api/work-orders/${otA.id}/parts`, { partId: refaccionA.id, quantity: 1 }],
      ["actividades de la orden", "POST", `/api/work-orders/${otA.id}/tasks`, { title: "mía ahora" }],
      ["activo (editar)", "PATCH", `/api/assets/${activoA.id}`, { name: "mío" }],
      ["activo (borrar)", "DELETE", `/api/assets/${activoA.id}`],
      ["solicitud", "POST", `/api/requests/${solicitudA.id}`, { action: "REJECT", reviewNotes: "no aplica aquí" }],
      ["refacción", "PATCH", `/api/parts/${refaccionA.id}`, { name: "mía" }],
      ["movimiento de almacén sobre refacción ajena", "POST", `/api/parts/movements`, { partId: refaccionA.id, movementType: "OUT", quantity: 1 }],
      ["proveedor", "PATCH", `/api/suppliers/${proveedorA.id}`, { name: "mío" }],
      ["plan", "PATCH", `/api/plans/${planA.id}`, { name: "mío" }],
      ["plan (borrar)", "DELETE", `/api/plans/${planA.id}`],
      ["surtir requisición ajena", "POST", `/api/requisiciones/${valeA.id}`, { accion: "SURTIR", entregadoA: "quien sea", renglones: [{ lineId: valeA.renglones[0].id, cantidad: 1 }] }],
      ["cancelar requisición ajena", "POST", `/api/requisiciones/${valeA.id}`, { accion: "CANCELAR" }],
      ["autorizar compra ajena", "POST", `/api/compras/${compraA.id}`, { accion: "AUTORIZAR" }],
      ["archivo adjunto", "GET", `/api/attachments/${adjuntoA.id}`],
      ["archivo adjunto (borrar)", "DELETE", `/api/attachments/${adjuntoA.id}`],
      ["medidor", "PATCH", `/api/meters/${medidorA.id}`, { maxIncrementoDia: 5 }],
      ["liga de referencia", "DELETE", `/api/links/${ligaA.id}`],
      ["usuario de otra empresa", "PATCH", `/api/users/${dueñoA.id}`, { role: "VIEWER" }],
      ["clave de un usuario ajeno", "POST", `/api/users/${dueñoA.id}/clave`, { password: "12345678" }],
    ];
    for (const [nombre, metodo, ruta, cuerpo] of cruces) {
      const r = await pedir(metodo, ruta, cookieB, cuerpo);
      revisar(`${nombre}: rechazado`, RECHAZO.includes(r.status), { status: r.status, cuerpo: r.texto.slice(0, 90) });
    }

    console.log("\n2. Y nada de la empresa A quedó tocado");
    const otDespues = await prisma.workOrder.findUniqueOrThrow({ where: { id: otA.id } });
    const activoDespues = await prisma.asset.findUnique({ where: { id: activoA.id } });
    const planDespues = await prisma.maintenancePlan.findUnique({ where: { id: planA.id } });
    const adjuntoDespues = await prisma.attachment.findUnique({ where: { id: adjuntoA.id } });
    const stockDespues = await prisma.partStock.findFirstOrThrow({ where: { partId: refaccionA.id } });
    const usuarioDespues = await prisma.user.findUniqueOrThrow({ where: { id: dueñoA.id } });
    revisar("la orden sigue igual", otDespues.title === "Orden de A" && otDespues.status === "IN_PROGRESS");
    revisar("el activo sigue vivo y con su nombre", activoDespues?.name === "Bomba de A" && activoDespues.active);
    revisar("el plan sigue existiendo", planDespues?.name === "Plan de A");
    revisar("el adjunto sigue existiendo", !!adjuntoDespues);
    revisar("la existencia no se movió", stockDespues.quantity === 5, stockDespues.quantity);
    revisar("el rol del usuario de A no cambió", usuarioDespues.role === "OWNER");
    revisar("la orden no ganó comentarios ni cargos",
      (await prisma.workOrderComment.count({ where: { workOrderId: otA.id } })) === 0 &&
      (await prisma.workOrderPart.count({ where: { workOrderId: otA.id } })) === 0 &&
      (await prisma.workOrderLabor.count({ where: { workOrderId: otA.id } })) === 0);
    revisar("la actividad de A sigue siendo la única de esa orden",
      (await prisma.workOrderTask.count({ where: { workOrderId: otA.id } })) === 1 &&
      (await prisma.workOrderTask.findUniqueOrThrow({ where: { id: actividadA.id } })).title === "Actividad de A");

    // ── 3. Listados: B no ve nada de A ──────────────────────────────────
    console.log("\n3. Los listados de B no traen datos de A");
    const listas: Array<[string, string, string]> = [
      ["órdenes", "/api/work-orders", "OT-A1"],
      ["activos", "/api/assets", "ACT-A1"],
      ["refacciones", "/api/parts", "REF-A1"],
      ["proveedores (pantalla)", "/suppliers", "Proveedor de A"],
      ["planes", "/api/plans", "Plan de A"],
      ["solicitudes", "/api/requests", "SOL-A1"],
      ["usuarios", "/api/users", "Dueña A"],
      ["compras (pantalla)", "/compras", "RC-A1"],
      ["requisiciones (pantalla)", "/requisiciones", "RM-A1"],
      ["kardex (pantalla)", "/inventory/kardex", "REF-A1"],
      ["reportes (pantalla)", "/reports", "OT-A1"],
      ["exportación de órdenes", "/api/export/work-orders", "OT-A1"],
      ["exportación de activos", "/api/export/assets", "ACT-A1"],
      ["exportación de inventario", "/api/export/inventory", "REF-A1"],
    ];
    for (const [nombre, ruta, rastro] of listas) {
      const r = await pedir("GET", ruta, cookieB);
      revisar(`${nombre}: sin rastro de la otra empresa`, r.status < 400 && !r.texto.includes(rastro), { status: r.status });
    }

    // ── 4. Sin sesion ───────────────────────────────────────────────────
    console.log("\n4. Sin sesión no se entrega nada");
    for (const ruta of [`/api/work-orders/${otA.id}`, `/api/attachments/${adjuntoA.id}`, "/api/export/work-orders", "/api/users"]) {
      const r = await pedir("GET", ruta, null);
      revisar(`${ruta}: 401`, r.status === 401, r.status);
    }

    // ── 5. El punto de reporte publico solo deja reportar ───────────────
    console.log("\n5. El QR público no abre información interna");
    const rPortal = await pedir("GET", `/reportar/${puntoA.token}`, null);
    revisar("la pantalla del QR abre sin sesión (así debe ser)", rPortal.status === 200, rPortal.status);
    revisar("y no muestra costos, personal ni el historial del equipo",
      !/costo|Costo|OT-A1|Dueña A|historial/i.test(rPortal.texto) || rPortal.texto.length === 0);
    const rPortalApi = await pedir("POST", "/api/publico", null, { accion: "RECUPERAR", folio: "SOL-A1", celular: "0000000000" });
    revisar("con el folio de A pero sin su celular, el portal no entrega la solicitud", rPortalApi.status === 404, rPortalApi.status);

    // Lo que el QR SI muestra: el nombre de la empresa y el equipo, para que
    // quien reporta sepa que esta en el lugar correcto. Nada mas.
    revisar("el QR nombra la empresa y el equipo, que es lo que el reportante necesita",
      rPortal.texto.length === 0 || /Bomba de A|ACT-A1|-A/.test(rPortal.texto));
    const fugas = [
      ["el número de una orden interna", "OT-A1"],
      ["el nombre del personal", "Dueña A"],
      ["el folio de una requisición", "RM-A1"],
      ["el folio de una compra", "RC-A1"],
      ["el nombre de un proveedor", "Proveedor de A"],
      ["un archivo adjunto", "evidencia-de-A"],
    ] as const;
    for (const [que, rastro] of fugas) {
      revisar(`el QR público no muestra ${que}`, !rPortal.texto.includes(rastro));
    }
    // Y la pantalla publica tampoco es una puerta a las APIs internas.
    for (const ruta of [`/api/assets`, `/api/work-orders`, `/api/parts`]) {
      const r = await pedir("GET", ruta, null);
      revisar(`sin sesión, ${ruta} no contesta datos`, r.status === 401, r.status);
    }

    // ── 6. Traspasos y conteos: documentos de A desde B ─────────────────
    console.log("\n6. Almacén: traspasos y conteos");
    const almacenB = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: orgB.id } });
    const rTraspaso = await pedir("POST", "/api/traspasos", cookieB, {
      origenId: almacenA.id, destinoId: almacenB.id, renglones: [{ partId: refaccionA.id, cantidad: 1 }],
    });
    revisar("un traspaso entre almacenes ajenos: rechazado", rTraspaso.status >= 400, { status: rTraspaso.status, cuerpo: rTraspaso.texto.slice(0, 90) });
  } finally {
    for (const org of [orgA, orgB]) {
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    }
    if (servidor?.pid) {
      try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya termino */ }
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
