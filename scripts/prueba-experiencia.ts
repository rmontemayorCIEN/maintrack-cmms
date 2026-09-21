/**
 * Bloque 6 — Experiencia por rol y operación móvil: permisos, flujos y datos.
 *
 * Siete roles en una empresa creada aquí (más otra para los cruces), contra
 * las mismas rutas y funciones que usa la pantalla: inicio por rol, menú,
 * pantallas por dirección directa, búsqueda, el ciclo completo del técnico
 * desde el teléfono, supervisión, compras, solicitante, consulta, QR, doble
 * toque, conflicto de edición, aislamiento entre empresas y archivos.
 *
 * Lo que solo se ve en un navegador de verdad (anchos de pantalla, tarjetas,
 * teclado, sin conexión, consola) está en scripts/prueba-responsiva.ts.
 *
 *   npx tsx scripts/prueba-experiencia.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}
process.env.AUTH_SECRET = llaveDeSesion();
process.env.AVISOS_CORREO = "prueba";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 300)}` : ""}`);
}
async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try { const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) }); if (r.status < 500) return; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

const DIA = 86_400_000;
const SIN_PERMISO = "Esta pantalla no es de su rol";
// Un PNG de 1×1: la foto más chica posible, para ejercitar la subida real.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const { prisma } = await import("../lib/db");
  const { inicioDe } = await import("../lib/inicio");
  const { menuDe, puedeVerRuta, accionesRapidasDe, barraDe, ROLES, TITULO_INICIO } = await import("../lib/pantallas");
  const { buscar } = await import("../lib/busqueda");
  const { puntoDeActivo } = await import("../lib/portal");

  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3206";
  if (!process.env.BASE_URL) servidor = spawn("npx", ["next", "dev", "-p", "3206", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });

  const sello = `ex-${Date.now()}`;
  const creadas: string[] = [];
  const foto = async () => {
    const where = { organizationId: { notIn: creadas } };
    return JSON.stringify(await Promise.all([
      prisma.workOrder.count({ where }), prisma.workRequest.count({ where }), prisma.attachment.count({ where }),
      prisma.notification.count({ where }), prisma.stockMovement.count({ where }), prisma.auditLog.count({ where }),
    ]));
  };
  const antes = await foto();
  const nuevaOrg = async (s: string) => {
    const o = await prisma.organization.create({
      data: { name: `${sello}-${s}`, slug: `${sello}-${s}`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5,6,7" },
    });
    creadas.push(o.id);
    return o;
  };
  const persona = (orgId: string, rol: string, nombre: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { organizationId: orgId, email: `${nombre.toLowerCase()}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x", hourlyRate: 100, ...extra } });

  try {
    const A = await nuevaOrg("a");
    const B = await nuevaOrg("b");
    const u = {
      OWNER: await persona(A.id, "OWNER", "Dueno"),
      ADMIN: await persona(A.id, "ADMIN", "Admin"),
      SUPERVISOR: await persona(A.id, "SUPERVISOR", "Sup"),
      TECHNICIAN: await persona(A.id, "TECHNICIAN", "Tec"),
      COMPRAS: await persona(A.id, "COMPRAS", "Compras"),
      REQUESTER: await persona(A.id, "REQUESTER", "Sol"),
      VIEWER: await persona(A.id, "VIEWER", "Consulta"),
    };
    const tec2 = await persona(A.id, "TECHNICIAN", "Tec2");
    const sol2 = await persona(A.id, "REQUESTER", "Sol2");
    const duenoB = await persona(B.id, "OWNER", "DuenoB");
    const operador = await persona(B.id, "OWNER", "Operador", { isSuperAdmin: true });

    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "VAL-7", name: "Válvula de alivio", serialNumber: "SN-4471", criticality: "B", purchaseCost: 5000, replacementCost: 9000 } });
    // Con su última lectura de hace dos días: 10 h de uso desde entonces es posible.
    const hace2 = new Date(Date.now() - 2 * DIA);
    const medidor = await prisma.meter.create({ data: { organizationId: A.id, assetId: equipo.id, name: "Horómetro", unit: "h", currentValue: 100, lastReadingAt: hace2 } });
    await prisma.meterReading.create({ data: { organizationId: A.id, meterId: medidor.id, value: 100, readingAt: hace2 } });
    const parte = await prisma.part.create({ data: { organizationId: A.id, code: `SEL-${sello}`, name: "Sello", unit: "pza", unitCost: 50, quantityOnHand: 0 } });
    // Existencia por el camino de siempre (aplicarMovimiento), no escribiendo el saldo a mano.
    const { aplicarMovimiento } = await import("../lib/almacen");
    await aplicarMovimiento({ organizationId: A.id, partId: parte.id, warehouseId: almacen.id, tipo: "IN", cantidad: 10, costoUnitario: 50, userId: u.OWNER.id, referencia: "Inventario inicial de prueba" });
    const otB = await prisma.workOrder.create({ data: { organizationId: B.id, number: `B-${sello}`, title: "De la otra empresa", maintenanceType: "CORRECTIVE", status: "OPEN" } });
    const adjuntoB = await prisma.attachment.create({ data: { organizationId: B.id, workOrderId: otB.id, name: "b.png", storagePath: `org-${B.id}/ordenes/b.png`, mimeType: "image/png", kind: "PHOTO", size: 10 } });
    const solAjena = await prisma.workRequest.create({ data: { organizationId: A.id, number: `S2-${sello}`, title: "Reporte de otra persona", requestedById: sol2.id } });
    const adjuntoAjeno = await prisma.attachment.create({ data: { organizationId: A.id, workRequestId: solAjena.id, name: "ajena.png", storagePath: `org-${A.id}/solicitudes/ajena.png`, mimeType: "image/png", kind: "PHOTO", size: 10 } });

    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const sesion = async (x: { id: string; organizationId: string; email: string; name: string; role: string }, extra: Record<string, unknown> = {}) =>
      ({ Cookie: `mt_session=${await new SignJWT({ userId: x.id, organizationId: x.organizationId, email: x.email, name: x.name, role: x.role, ...extra })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}` });
    const c: Record<string, Record<string, string>> = {};
    for (const [rol, x] of Object.entries(u)) c[rol] = await sesion(x);
    const cB = await sesion(duenoB);
    const pedir = async (metodo: string, ruta: string, cab: Record<string, string>, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo, headers: { "Content-Type": "application/json", ...cab }, redirect: "manual",
        ...(cuerpo !== undefined ? { body: typeof cuerpo === "string" || cuerpo instanceof Buffer ? cuerpo : JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(180_000),
      });
      const texto = await r.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(texto); } catch { /* html */ }
      return { status: r.status, json, texto };
    };
    const pagina = (ruta: string, cab: Record<string, string>) => pedir("GET", ruta, cab);

    // Una OT del técnico, lista para ejecutarse desde el teléfono.
    const ot = await prisma.workOrder.create({
      data: {
        organizationId: A.id, number: `OT-${sello}`, title: "Revisar fuga en válvula", maintenanceType: "INSPECTION", priority: "HIGH",
        status: "ASSIGNED", assetId: equipo.id, siteId: sitio.id, assignedToId: u.TECHNICIAN.id, estimatedHours: 2,
        dueDate: new Date(Date.now() + DIA), safetyNotes: "Despresurizar antes de abrir",
        tasks: { create: [{ title: "Revisar empaque", position: 0 }] },
      },
      include: { tasks: true },
    });
    const { avisarNuevaOrden } = await import("../lib/avisos/ordenes");
    await avisarNuevaOrden(A.id, ot.id);

    // ═══════════════════════════════════════════ 1-7, 15-16: inicio y menú por rol
    console.log("\n1-7 y 15-16. Inicio y menú por rol");
    const inicios: Record<string, Awaited<ReturnType<typeof inicioDe>>> = {};
    for (const rol of ROLES) {
      const x = await prisma.user.findUniqueOrThrow({ where: { id: u[rol].id }, include: { organization: true } });
      inicios[rol] = await inicioDe(x);
      const html = await pagina("/dashboard", c[rol]);
      const menu = menuDe(rol).flatMap((g) => g.items.map((i) => i.href));
      // Solo pantallas: los íconos y el manifiesto (con extensión) no son ligas de navegación.
      const ligasProhibidas = [...html.texto.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]).filter((h) => !h.startsWith("/_next") && !h.startsWith("/api/") && !/\.[a-z]+$/.test(h) && !puedeVerRuta(rol, h));
      revisar(`${ROLES.indexOf(rol) + 1}. ${rol}: su inicio «${TITULO_INICIO[rol]}», su menú y ninguna liga a pantallas que no puede abrir`,
        html.status === 200 && html.texto.includes(TITULO_INICIO[rol]) && menu.every((h) => puedeVerRuta(rol, h)) && !ligasProhibidas.length,
        { status: html.status, prohibidas: [...new Set(ligasProhibidas)].slice(0, 5) });
    }
    const firmas = ROLES.map((r) => `${inicios[r].titulo}|${inicios[r].resumen.map((x) => x.etiqueta).join(",")}`);
    revisar("15. inicio distinto para cada rol (título y resumen propios)", new Set(firmas).size === ROLES.length, firmas.map((f) => f.slice(0, 40)));
    revisar("    el técnico ve su orden; el dueño liga a Indicadores y Reportes; la administración a sus pantallas; nadie más",
      JSON.stringify(inicios.TECHNICIAN.bloques).includes(ot.number) && inicios.OWNER.masDetalle.some((d) => d.href === "/indicadores") && ROLES.filter((r) => !["OWNER", "ADMIN"].includes(r)).every((r) => !inicios[r].masDetalle.length));
    revisar("    las acciones rápidas de cada rol llevan a pantallas que puede abrir", ROLES.every((r) => accionesRapidasDe(r).every((a) => a.href.startsWith("#") || puedeVerRuta(r, a.href))));
    revisar("    la barra del teléfono de cada rol, también", ROLES.every((r) => barraDe(r).every((i) => puedeVerRuta(r, i.href))));
    const menuSol = menuDe("REQUESTER").flatMap((g) => g.items.map((i) => i.href));
    const menuCon = menuDe("VIEWER").flatMap((g) => g.items.map((i) => i.href));
    revisar("16. menú: el solicitante no ve almacén, compras ni órdenes; consulta no ve importar ni configuración",
      !["/inventory", "/compras", "/work-orders", "/suppliers"].some((h) => menuSol.includes(h)) && !["/import", "/catalogs", "/puesta-en-marcha"].some((h) => menuCon.includes(h)),
      { menuSol, menuCon });

    // ═══════════════════════════════════════════ 17: dirección directa
    console.log("\n17. Pantallas por dirección directa");
    const prohibidas: Array<[string, string]> = [
      ["REQUESTER", "/inventory"], ["REQUESTER", "/compras"], ["REQUESTER", "/work-orders"], ["REQUESTER", "/reports"], ["REQUESTER", "/settings?s=usuarios"],
      ["VIEWER", "/import"], ["VIEWER", "/compras"], ["VIEWER", "/work-orders/new"],
      ["TECHNICIAN", "/reports"], ["TECHNICIAN", "/suppliers"], ["TECHNICIAN", "/inventory/kardex"], ["TECHNICIAN", "/equipo"],
      ["COMPRAS", "/work-orders"], ["COMPRAS", "/assets"], ["SUPERVISOR", "/import"], ["ADMIN", "/clients"], ["OWNER", "/clients"],
    ];
    const resultados17 = [];
    for (const [rol, ruta] of prohibidas) {
      const r = await pagina(ruta, c[rol]);
      const bloqueada = ruta.includes("?s=usuarios") ? !r.texto.includes(u.ADMIN.email) : r.texto.includes(SIN_PERMISO);
      resultados17.push({ rol, ruta, bloqueada, status: r.status });
    }
    revisar("17. cada pantalla ajena responde «Sin permiso» (o no muestra lo ajeno), sin sus datos", resultados17.every((x) => x.bloqueada), resultados17.filter((x) => !x.bloqueada));
    const permitidas = await Promise.all([pagina("/work-orders", c.TECHNICIAN), pagina("/compras", c.COMPRAS), pagina("/requests", c.REQUESTER), pagina("/reports", c.VIEWER)]);
    revisar("    y las propias sí abren", permitidas.every((r) => r.status === 200 && !r.texto.includes(SIN_PERMISO)), permitidas.map((r) => r.status));
    const apis = await Promise.all([
      pedir("GET", "/api/parts", c.REQUESTER), pedir("GET", "/api/work-orders", c.COMPRAS), pedir("GET", "/api/users", c.TECHNICIAN),
      pedir("GET", "/api/requests", c.COMPRAS), pedir("GET", "/api/assets", c.REQUESTER),
    ]);
    revisar("    las consultas de la API de esas pantallas también se niegan (403)", apis.every((r) => r.status === 403), apis.map((r) => r.status));
    const otTec = await pedir("GET", `/api/work-orders/${ot.id}`, c.TECHNICIAN);
    const otSup = await pedir("GET", `/api/work-orders/${ot.id}`, c.SUPERVISOR);
    const wo = otTec.json.workOrder as Record<string, unknown>;
    revisar("    el técnico recibe la orden sin costos ni datos personales; supervisión, con costos",
      otTec.status === 200 && !("laborCost" in wo) && !("totalCost" in wo) && !JSON.stringify(wo).includes("passwordHash") && !JSON.stringify(wo).includes("@t.mx") &&
      "totalCost" in (otSup.json.workOrder as Record<string, unknown>));
    const pagTec = await pagina(`/work-orders/${ot.id}`, c.TECHNICIAN);
    const pagSup = await pagina(`/work-orders/${ot.id}`, c.SUPERVISOR);
    revisar("    y en la pantalla de la orden el técnico no ve la tarjeta de costos; supervisión sí", !pagTec.texto.includes(">Costos<") && pagSup.texto.includes(">Costos<"));

    // ═══════════════════════════════════════════ 18, 37: búsqueda
    console.log("\n18 y 37. Búsqueda");
    const aU = async (rol: keyof typeof u) => ({ ...(await prisma.user.findUniqueOrThrow({ where: { id: u[rol].id } })) });
    const bSol = await buscar(await aU("REQUESTER"), parte.code);
    const bTec = await buscar(await aU("TECHNICIAN"), "valvula");
    const bSolReq = await buscar(await aU("REQUESTER"), "reporte de otra");
    const bB = await buscar({ ...duenoB }, "valvula");
    revisar("18. búsqueda limitada: el solicitante no encuentra refacciones ni reportes ajenos; otra empresa no encuentra nada de esta",
      !bSol.some((g) => g.tipo === "refaccion") && !bSolReq.length && !bB.some((g) => g.resultados.some((r) => r.id === equipo.id)), { bSol, bSolReq: bSolReq.length });
    revisar("    sin acentos ni mayúsculas: «valvula» encuentra «Válvula de alivio»", bTec.some((g) => g.resultados.some((r) => r.id === equipo.id)));
    const bCodigo = await buscar(await aU("TECHNICIAN"), "val-7");
    const bSerie = await buscar(await aU("SUPERVISOR"), "sn-4471");
    revisar("37. por código del equipo (en minúsculas) sale primero, y por número de serie también, sin repetidos",
      bCodigo.find((g) => g.tipo === "activo")?.resultados[0]?.id === equipo.id && bSerie.some((g) => g.resultados.some((r) => r.id === equipo.id)) &&
      bCodigo.every((g) => new Set(g.resultados.map((r) => r.id)).size === g.resultados.length));

    // ═══════════════════════════════════════════ 19-26: el técnico desde el teléfono
    console.log("\n19-26. La orden completa del técnico");
    const r19 = await pedir("POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "IN_PROGRESS" });
    const asignada = await prisma.notification.findFirst({ where: { userId: u.TECHNICIAN.id, tipo: "OT_ASIGNADA", entidadId: ot.id } });
    revisar("19. acepta e inicia su orden; el aviso de asignación queda atendido «La OT se inició»", r19.status === 200 && asignada?.atendidaMotivo === "La OT se inició", { status: r19.status, motivo: asignada?.atendidaMotivo });
    const r20 = await pedir("PATCH", `/api/work-orders/${ot.id}/tasks`, c.TECHNICIAN, { taskId: ot.tasks[0].id, done: true });
    revisar("20. marca la actividad", r20.status === 200 && (await prisma.workOrderTask.findUniqueOrThrow({ where: { id: ot.tasks[0].id } })).done);
    const r21 = await pedir("POST", `/api/work-orders/${ot.id}/labor`, c.TECHNICIAN, { hours: 1.5 });
    revisar("21. registra su tiempo", r21.status === 201);
    const r22 = await pedir("POST", `/api/work-orders/${ot.id}/parts`, c.TECHNICIAN, { partId: parte.id, quantity: 1 });
    revisar("22. consume material (sale del almacén por el kardex)", r22.status === 201 && (await prisma.part.findUniqueOrThrow({ where: { id: parte.id } })).quantityOnHand === 9, r22.json.error);
    const r23 = await pedir("POST", "/api/readings", c.TECHNICIAN, { meterId: medidor.id, value: 110 });
    revisar("23. captura la lectura del equipo", r23.status < 300 && (await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } })).currentValue === 110, { status: r23.status, error: r23.json.error });
    const base24 = { workOrderId: ot.id, name: "evidencia.png", mimeType: "image/png", size: PNG.length };
    const p1 = await pedir("POST", "/api/attachments", c.TECHNICIAN, base24);
    const p2 = await fetch(`${base}${p1.json.url as string}`, { method: "PUT", headers: { ...c.TECHNICIAN, "Content-Type": "image/png" }, body: PNG });
    const p3 = await pedir("PUT", "/api/attachments", c.TECHNICIAN, { ...base24, storagePath: p1.json.storagePath });
    const adjunto = p3.json.attachment as { id: string } | undefined;
    const lectura = adjunto ? await fetch(`${base}/api/attachments/${adjunto.id}`, { headers: c.SUPERVISOR, redirect: "manual" }) : null;
    revisar("24. adjunta la fotografía (permiso, subida, confirmación) y supervisión la ve", p1.status === 200 && p2.ok && p3.status === 201 && Boolean(lectura && lectura.status < 400), { p1: p1.status, p2: p2.status, p3: p3.status, lee: lectura?.status });
    const r25 = await pedir("POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "ON_HOLD", motivo: "Falta el empaque correcto" });
    const detenida = await prisma.notification.findFirst({ where: { tipo: "OT_DETENIDA", entidadId: ot.id } });
    const apoyo = await pedir("POST", `/api/work-orders/${ot.id}/comments`, c.TECHNICIAN, { body: "Necesito otra persona para cargar", pedirApoyo: true });
    const avisoApoyo = await prisma.notification.findFirst({ where: { tipo: "OT_APOYO_SOLICITADO", entidadId: ot.id, userId: u.SUPERVISOR.id } });
    revisar("25. reporta bloqueo (en espera con motivo) y pide apoyo: supervisión recibe los dos avisos",
      r25.status === 200 && Boolean(detenida) && apoyo.status === 201 && Boolean(avisoApoyo), { r25: r25.status, apoyo: apoyo.status });
    await pedir("POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "IN_PROGRESS" });
    const r26 = await pedir("POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "COMPLETED", resolution: "Se cambió el empaque y se probó sin fuga", motivoSinDiagnostico: "Inspección sin falla" });
    const revision = await prisma.notification.findFirst({ where: { tipo: "OT_LISTA_REVISION", entidadId: ot.id, userId: u.SUPERVISOR.id } });
    revisar("26. termina y la envía a revisión: supervisión recibe «lista para revisión»", r26.status === 200 && Boolean(revision), { status: r26.status, error: r26.json.error });
    const vistaSup = await pedir("GET", `/api/work-orders/${ot.id}`, c.SUPERVISOR);
    const w = vistaSup.json.workOrder as { status: string; tasks: Array<{ done: boolean }>; labor: unknown[]; partsUsed: unknown[] };
    revisar("    lo hecho desde el teléfono se ve igual desde la computadora (estado, actividades, tiempo, material)",
      w.status === "COMPLETED" && w.tasks.every((t) => t.done) && w.labor.length === 1 && w.partsUsed.length === 1);

    // ═══════════════════════════════════════════ 27-29: supervisión
    console.log("\n27-29. Supervisión");
    const ot2 = await prisma.workOrder.create({ data: { organizationId: A.id, number: `OT2-${sello}`, title: "Lubricar", maintenanceType: "INSPECTION", status: "OPEN", assetId: equipo.id, estimatedHours: 1, dueDate: new Date(Date.now() + 2 * DIA) } });
    const a1 = await pedir("PATCH", `/api/work-orders/${ot2.id}`, c.SUPERVISOR, { assignedToId: u.TECHNICIAN.id, base: { assignedToId: "" }, aceptarAdvertencias: true });
    const a2 = await pedir("PATCH", `/api/work-orders/${ot2.id}`, c.SUPERVISOR, { assignedToId: tec2.id, base: { assignedToId: u.TECHNICIAN.id }, aceptarAdvertencias: true });
    const reasignada = await prisma.notification.findFirst({ where: { tipo: "OT_REASIGNADA", entidadId: ot2.id, userId: u.TECHNICIAN.id } });
    revisar("27. asigna y reasigna: el nuevo responsable recibe la asignación y el anterior que ya no es suya",
      a1.status === 200 && a2.status === 200 && (await prisma.workOrder.findUniqueOrThrow({ where: { id: ot2.id } })).assignedToId === tec2.id && Boolean(reasignada), [a1.status, a2.status]);
    const r28 = await pedir("POST", `/api/work-orders/${ot.id}/status`, c.SUPERVISOR, { status: "IN_PROGRESS", motivo: "Falta la foto del después" });
    const devuelta = await prisma.notification.findFirst({ where: { tipo: "OT_DEVUELTA", entidadId: ot.id, userId: u.TECHNICIAN.id } });
    revisar("28. revisa y devuelve con motivo: el técnico recibe «OT devuelta»", r28.status === 200 && Boolean(devuelta), r28.json.error);
    await pedir("POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "COMPLETED", resolution: "Se cambió el empaque; foto agregada", motivoSinDiagnostico: "Inspección sin falla" });
    const r29 = await pedir("POST", `/api/work-orders/${ot.id}/status`, c.SUPERVISOR, { status: "CLOSED" });
    revisar("29. cierra la orden", r29.status === 200 && (await prisma.workOrder.findUniqueOrThrow({ where: { id: ot.id } })).status === "CLOSED", r29.json.error);

    // ═══════════════════════════════════════════ 30-31: compras
    console.log("\n30-31. Compras");
    const alta = await pedir("POST", "/api/compras", c.COMPRAS, { warehouseId: almacen.id, urgencia: "NORMAL", justificacion: "Reponer sellos", renglones: [{ partId: parte.id, descripcion: "Sello", cantidadSolicitada: 4, costoEstimado: 50 }] });
    const compraId = ((alta.json.compra ?? alta.json.request ?? alta.json.purchaseRequest) as { id: string } | undefined)?.id
      ?? (await prisma.purchaseRequest.findFirst({ where: { organizationId: A.id }, orderBy: { createdAt: "desc" } }))?.id;
    const firmaCompras = await pedir("POST", `/api/compras/${compraId}`, c.COMPRAS, { accion: "AUTORIZAR" });
    const firmaDueno = await pedir("POST", `/api/compras/${compraId}`, c.OWNER, { accion: "AUTORIZAR" });
    const colocar = await pedir("POST", `/api/compras/${compraId}`, c.COMPRAS, { accion: "COLOCAR", ordenCompra: "OC-900" });
    revisar("30. Compras procesa la requisición: la pide, no se la autoriza a sí misma (403), el dueño la firma y Compras coloca la orden",
      alta.status < 300 && firmaCompras.status === 403 && firmaDueno.status === 200 && colocar.status === 200, [alta.status, firmaCompras.status, firmaDueno.status, colocar.status]);
    const renglon = await prisma.purchaseRequestLine.findFirstOrThrow({ where: { requestId: compraId } });
    const recibe = await pedir("POST", `/api/compras/${compraId}`, c.COMPRAS, { accion: "RECIBIR", renglones: [{ requestLineId: renglon.id, partId: parte.id, cantidad: 1, costoUnitario: 50 }] });
    const inicioCompras = await inicioDe(await prisma.user.findUniqueOrThrow({ where: { id: u.COMPRAS.id }, include: { organization: true } }));
    const detalle = await pagina(`/compras/${compraId}`, c.COMPRAS);
    revisar("31. recepción parcial: queda «recibida en parte», aparece en su inicio con la diferencia y la consulta abre",
      recibe.status === 200 && (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: compraId } })).estado === "RECIBIDA_PARCIAL" &&
      JSON.stringify(inicioCompras.bloques.find((b) => b.id === "parciales") ?? {}).includes("llegaron 1 de 4") && detalle.status === 200 && !detalle.texto.includes(SIN_PERMISO),
      { recibe: recibe.status, bloques: inicioCompras.bloques.map((b) => b.id) });

    // ═══════════════════════════════════════════ 32-33: solicitante
    console.log("\n32-33. Solicitante");
    const sol = await pedir("POST", "/api/requests", c.REQUESTER, { title: "Gotea la llave del baño", donde: "Baño de planta baja", impideTrabajar: false, riesgo: "ALTO", riesgoMotivo: "Piso mojado", contacto: "8112345678" });
    const solId = (sol.json.request as { id: string }).id;
    const f1 = await pedir("POST", "/api/attachments", c.REQUESTER, { workRequestId: solId, name: "llave.png", mimeType: "image/png", size: PNG.length });
    await fetch(`${base}${f1.json.url as string}`, { method: "PUT", headers: { ...c.REQUESTER, "Content-Type": "image/png" }, body: PNG });
    const f3 = await pedir("PUT", "/api/attachments", c.REQUESTER, { workRequestId: solId, name: "llave.png", mimeType: "image/png", size: PNG.length, storagePath: f1.json.storagePath });
    const guardada = await prisma.workRequest.findUniqueOrThrow({ where: { id: solId }, include: { attachments: true } });
    revisar("32. crea su reporte en palabras sencillas, con fotografía: el lugar, si impide trabajar y el riesgo quedan registrados",
      sol.status === 201 && f3.status === 201 && guardada.attachments.length === 1 && guardada.riesgo === "ALTO" && guardada.description?.includes("Dónde: Baño de planta baja") === true && guardada.reporterCelular === "8112345678",
      { sol: sol.status, foto: f3.status });
    const lista = await pedir("GET", "/api/requests", c.REQUESTER);
    const ajenaPag = await pagina(`/requests/${solAjena.id}`, c.REQUESTER);
    const ajenaFoto = await pedir("POST", "/api/attachments", c.REQUESTER, { workRequestId: solAjena.id, name: "x.png", mimeType: "image/png", size: 10 });
    const ajenaVer = await fetch(`${base}/api/attachments/${adjuntoAjeno.id}`, { headers: c.REQUESTER, redirect: "manual" });
    const listaHtml = await pagina("/requests", c.REQUESTER);
    revisar("33. consulta únicamente sus reportes: la lista, el detalle, las fotos y la búsqueda no muestran los ajenos",
      (lista.json.requests as Array<{ id: string }>).every((r) => r.id !== solAjena.id) && (lista.json.requests as unknown[]).length === 1 &&
      ajenaPag.status === 404 && ajenaFoto.status === 404 && ajenaVer.status === 404 && listaHtml.texto.includes("Mis reportes") && !listaHtml.texto.includes("Reporte de otra persona"),
      { ajenaPag: ajenaPag.status, ajenaFoto: ajenaFoto.status, ajenaVer: ajenaVer.status });

    // ═══════════════════════════════════════════ 34: consulta
    console.log("\n34. Consulta");
    const intentos = await Promise.all([
      pedir("POST", "/api/work-orders", c.VIEWER, { title: "No debería", maintenanceType: "CORRECTIVE" }),
      pedir("PATCH", `/api/work-orders/${ot2.id}`, c.VIEWER, { title: "Cambiado por consulta" }),
      pedir("POST", `/api/work-orders/${ot2.id}/status`, c.VIEWER, { status: "IN_PROGRESS" }),
      pedir("POST", `/api/work-orders/${ot2.id}/parts`, c.VIEWER, { partId: parte.id, quantity: 1 }),
      pedir("POST", "/api/requests", c.VIEWER, { title: "No debería" }),
      pedir("POST", "/api/readings", c.VIEWER, { meterId: medidor.id, value: 200 }),
    ]);
    const pagConsulta = await pagina(`/work-orders/${ot2.id}`, c.VIEWER);
    revisar("34. consulta intenta modificar: el servidor rechaza todo (403) y la pantalla no ofrece acciones",
      intentos.every((r) => r.status === 403) && (await prisma.workOrder.findUniqueOrThrow({ where: { id: ot2.id } })).title === "Lubricar" && !pagConsulta.texto.includes("Iniciar"),
      intentos.map((r) => r.status));

    // ═══════════════════════════════════════════ 35-36: QR
    console.log("\n35-36. QR");
    const punto = await puntoDeActivo(A.id, equipo.id, u.OWNER.id);
    const publico = await pagina(`/reportar/${punto.token}`, {});
    revisar("35. QR público: formulario sencillo, sin datos internos (serie, costos, órdenes)",
      publico.status === 200 && publico.texto.includes("Reportar una falla") && !publico.texto.includes("SN-4471") && !publico.texto.includes("9,000") && !publico.texto.includes(ot.number) && !publico.texto.includes("Con su usuario"));
    const qrTec = await pagina(`/reportar/${punto.token}`, c.TECHNICIAN);
    const qrSol = await pagina(`/reportar/${punto.token}`, c.REQUESTER);
    const qrSup = await pagina(`/reportar/${punto.token}`, c.SUPERVISOR);
    const qrB = await pagina(`/reportar/${punto.token}`, cB);
    revisar("36. QR autenticado según el rol: técnico abre el equipo y registra lectura; supervisión además crea OT; solicitante reporta con su usuario; otra empresa, solo el público",
      qrTec.texto.includes("Abrir el equipo") && qrTec.texto.includes("Registrar una lectura") && !qrTec.texto.includes("Crear una orden de trabajo") &&
      qrSup.texto.includes("Crear una orden de trabajo") &&
      qrSol.texto.includes("Reportar con mi usuario") && !qrSol.texto.includes("Abrir el equipo") &&
      !qrB.texto.includes("Con su usuario"));

    // ═══════════════════════════════════════════ 38-39: validación y doble toque
    console.log("\n38-39. Validación y doble toque");
    const ot3 = await prisma.workOrder.create({ data: { organizationId: A.id, number: `OT3-${sello}`, title: "Doble toque", maintenanceType: "INSPECTION", status: "IN_PROGRESS", startedAt: new Date(), assignedToId: u.TECHNICIAN.id, assetId: equipo.id, estimatedHours: 1 } });
    const malas = await pedir("POST", `/api/work-orders/${ot3.id}/labor`, c.TECHNICIAN, { hours: 30 });
    revisar("38. error de validación: dice qué campo y qué se espera (422), sin guardar nada", malas.status === 422 && /24/.test(String(malas.json.error)) && !(await prisma.workOrderLabor.count({ where: { workOrderId: ot3.id } })), malas.json.error);
    const existenciaAntes = (await prisma.part.findUniqueOrThrow({ where: { id: parte.id } })).quantityOnHand;
    const dobleParte = await Promise.all([1, 2].map(() => pedir("POST", `/api/work-orders/${ot3.id}/parts`, c.TECHNICIAN, { partId: parte.id, quantity: 2 })));
    const dobleHoras = await Promise.all([1, 2].map(() => pedir("POST", `/api/work-orders/${ot3.id}/labor`, c.TECHNICIAN, { hours: 0.5 })));
    const dobleEstado = await Promise.all([1, 2].map(() => pedir("POST", `/api/work-orders/${ot3.id}/status`, c.TECHNICIAN, { status: "ON_HOLD", motivo: "Esperando material" })));
    const dobleSol = await Promise.all([1, 2].map(() => pedir("POST", `/api/compras/${compraId}`, c.COMPRAS, { accion: "RECIBIR", clave: `rec-${sello}`, renglones: [{ requestLineId: renglon.id, partId: parte.id, cantidad: 1, costoUnitario: 50 }] })));
    const existenciaDespues = (await prisma.part.findUniqueOrThrow({ where: { id: parte.id } })).quantityOnHand;
    revisar("39. doble toque: el consumo, las horas, el cambio de estado y la recepción cuentan una vez",
      dobleParte.map((r) => r.status).sort().join() === "201,409" && existenciaDespues === existenciaAntes - 2 + 1 &&
      dobleHoras.map((r) => r.status).sort().join() === "201,409" && (await prisma.workOrderLabor.count({ where: { workOrderId: ot3.id } })) === 1 &&
      // El segundo toque encuentra la orden ya en espera: responde bien pero no repite la transición.
      (await prisma.auditLog.count({ where: { organizationId: A.id, entityId: ot3.id, action: "STATUS_CHANGED" } })) === 1 &&
      (await prisma.notification.count({ where: { tipo: "OT_DETENIDA", entidadId: ot3.id, userId: u.SUPERVISOR.id } })) === 1 &&
      (await prisma.goodsReceipt.count({ where: { organizationId: A.id, clave: `rec-${sello}` } })) === 1,
      { partes: dobleParte.map((r) => r.status), horas: dobleHoras.map((r) => r.status), estado: dobleEstado.map((r) => r.status), existenciaAntes, existenciaDespues });

    // Bloque 8: crear una ORDEN y crear una REQUISICION tampoco pueden
    // duplicarse. Eran los dos unicos formularios sin defensa de servidor: lo
    // unico que los cuidaba era que el boton se deshabilitara en el navegador,
    // y eso no sobrevive a un reintento de red ni a una segunda pestana.
    const dobleOT = await Promise.all([1, 2].map(() => pedir("POST", "/api/work-orders", c.SUPERVISOR, {
      title: `Doble creacion ${sello}`, maintenanceType: "CORRECTIVE", priority: "MEDIUM",
      assetId: equipo.id, aceptarAdvertencias: true,
    })));
    const creadas = await prisma.workOrder.count({ where: { organizationId: A.id, title: `Doble creacion ${sello}` } });
    const dobleReq = await Promise.all([1, 2].map(() => pedir("POST", "/api/requisiciones", c.TECHNICIAN, {
      renglones: [{ partId: parte.id, descripcion: "Material del doble toque", cantidadSolicitada: 1 }],
      urgencia: "NORMAL", assetId: equipo.id,
    })));
    const requisiciones = await prisma.materialRequest.count({ where: { organizationId: A.id, solicitanteId: u.TECHNICIAN.id } });
    revisar("39b. crear una orden y crear una requisición dos veces seguidas dejan UNA de cada una",
      creadas === 1 && dobleOT.map((r) => r.status).sort().join() === "201,409" &&
      requisiciones === 1 && dobleReq.map((r) => r.status).sort().join() === "201,409",
      { ot: dobleOT.map((r) => r.status), creadas, req: dobleReq.map((r) => r.status), requisiciones });

    // Quitar lo que se cargó por error. Lo que de verdad importa aquí no es
    // que desaparezca el renglón, sino que la refacción REGRESE al almacén:
    // borrarla sin devolverla dejaría al almacén creyendo que hay menos de lo
    // que hay, y al kardex sin explicación de a dónde se fue.
    const antesDeQuitar = (await prisma.part.findUniqueOrThrow({ where: { id: parte.id } })).quantityOnHand;
    const cargada = await pedir("POST", `/api/work-orders/${ot3.id}/parts`, c.TECHNICIAN, { partId: parte.id, quantity: 3 });
    const trasCargar = (await prisma.part.findUniqueOrThrow({ where: { id: parte.id } })).quantityOnHand;
    const linea = await prisma.workOrderPart.findFirstOrThrow({ where: { workOrderId: ot3.id, partId: parte.id, quantity: 3 } });
    const costoConLaRefaccion = (await prisma.workOrder.findUniqueOrThrow({ where: { id: ot3.id } })).partsCost;
    const quitada = await pedir("DELETE", `/api/work-orders/${ot3.id}/parts?linea=${linea.id}`, c.TECHNICIAN);
    const trasQuitar = await prisma.part.findUniqueOrThrow({ where: { id: parte.id } });
    const devolucion = await prisma.stockMovement.findFirst({ where: { workOrderId: ot3.id, partId: parte.id, movementType: "RETURN" } });
    const otTrasQuitar = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot3.id } });
    revisar("39c. quitar una refacción cargada por error la devuelve al almacén, deja el movimiento en el kardex y recalcula el costo",
      cargada.status === 201 && quitada.status === 200 &&
      trasCargar === antesDeQuitar - 3 && trasQuitar.quantityOnHand === antesDeQuitar &&
      !!devolucion && devolucion.quantity === 3 &&
      otTrasQuitar.partsCost === costoConLaRefaccion - 3 * parte.unitCost &&
      (await prisma.workOrderPart.count({ where: { id: linea.id } })) === 0,
      { antes: antesDeQuitar, tras: trasQuitar.quantityOnHand, devolucion: devolucion?.quantity, costo: [costoConLaRefaccion, otTrasQuitar.partsCost] });

    // Y las horas: ahí sí es borrar, porque no movieron nada fuera de la orden.
    const horas = await pedir("POST", `/api/work-orders/${ot3.id}/labor`, c.TECHNICIAN, { hours: 2, notes: "capturada por error" });
    const lineaHoras = await prisma.workOrderLabor.findFirstOrThrow({ where: { workOrderId: ot3.id, hours: 2 } });
    const ajena = await pedir("DELETE", `/api/work-orders/${ot3.id}/labor?linea=${lineaHoras.id}`, c.REQUESTER);
    const propias = await pedir("DELETE", `/api/work-orders/${ot3.id}/labor?linea=${lineaHoras.id}`, c.TECHNICIAN);
    const otTrasHoras = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot3.id } });
    // Un técnico no puede borrar lo que capturó otro; quien supervisa, sí:
    // es quien valida el trabajo antes de cerrarlo.
    const deOtro = await prisma.workOrderLabor.create({ data: { workOrderId: ot3.id, userId: tec2.id, hours: 3, cost: 300, rate: 100, workedAt: new Date() } });
    const deOtroPorElTecnico = await pedir("DELETE", `/api/work-orders/${ot3.id}/labor?linea=${deOtro.id}`, c.TECHNICIAN);
    const deOtroPorSupervision = await pedir("DELETE", `/api/work-orders/${ot3.id}/labor?linea=${deOtro.id}`, c.SUPERVISOR);
    revisar("39e. un técnico no quita las horas de otro; supervisión sí",
      deOtroPorElTecnico.status === 403 && deOtroPorSupervision.status === 200 &&
      (await prisma.workOrderLabor.count({ where: { id: deOtro.id } })) === 0,
      { tecnico: deOtroPorElTecnico.status, supervision: deOtroPorSupervision.status });

    revisar("39d. el técnico quita las horas que capturó por error; el costo y las horas de la orden se rehacen",
      horas.status === 201 && ajena.status === 403 && propias.status === 200 &&
      (await prisma.workOrderLabor.count({ where: { id: lineaHoras.id } })) === 0 &&
      otTrasHoras.actualHours === 0.5,
      { ajena: ajena.status, propias: propias.status, horas: otTrasHoras.actualHours });

    // ═══════════════════════════════════════════ 41: conflicto
    console.log("\n41. Conflicto por cambio simultáneo");
    const e1 = await pedir("PATCH", `/api/work-orders/${ot2.id}`, c.SUPERVISOR, { title: "Lubricar rodamientos", base: { title: "Lubricar" }, aceptarAdvertencias: true });
    const e2 = await pedir("PATCH", `/api/work-orders/${ot2.id}`, c.ADMIN, { title: "Lubricar y limpiar", base: { title: "Lubricar" }, aceptarAdvertencias: true });
    const e3 = await pedir("PATCH", `/api/work-orders/${ot2.id}`, c.ADMIN, { priority: "HIGH", base: { priority: "MEDIUM" }, aceptarAdvertencias: true });
    const final = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot2.id } });
    revisar("41. la segunda edición del mismo campo se rechaza (409, dice cuál) y no pisa; otro campo sí se guarda sin tocar el título",
      e1.status === 200 && e2.status === 409 && String(e2.json.error).includes("el título") && e3.status === 200 && final.title === "Lubricar rodamientos" && final.priority === "HIGH",
      { e1: e1.status, e2: e2.status, e3: e3.status, error: e2.json.error, titulo: final.title });

    // ═══════════════════════════════════════════ Cierre del bloque: roles, QR, aceptar, doble envío
    console.log("\nCierre: roles, QR, aceptar y doble envío");
    const menuTec = menuDe("TECHNICIAN").flatMap((g) => g.items.map((i) => i.href));
    const comprasTec = await Promise.all([pagina("/compras", c.TECHNICIAN), pagina(`/compras/${compraId}`, c.TECHNICIAN)]);
    revisar("técnico: sin Compras completas (ni en el menú ni por dirección), sin configuración ni empresas cliente",
      !menuTec.includes("/compras") && comprasTec.every((r) => r.texto.includes(SIN_PERMISO)) && !menuTec.some((h) => ["/settings?s=usuarios", "/catalogs", "/clients", "/import"].includes(h)) &&
      menuTec.includes("/escanear") && accionesRapidasDe("TECHNICIAN").some((a) => a.etiqueta === "Registrar lectura"));
    const admin = inicios.ADMIN;
    const auditoria = await pagina("/settings?s=auditoria", c.ADMIN);
    revisar("administrador: su inicio liga a usuarios, configuración, catálogos, calidad, puesta en marcha y auditoría, y la auditoría abre",
      ["/settings?s=usuarios", "/settings?s=organizacion", "/catalogs", "/puesta-en-marcha", "/settings?s=auditoria"].every((h) => admin.masDetalle.some((d) => d.href === h)) && auditoria.status === 200 && !auditoria.texto.includes(SIN_PERMISO),
      { ligas: admin.masDetalle.map((d) => d.href), auditoria: auditoria.status, sinPermiso: auditoria.texto.includes(SIN_PERMISO) });
    const dueno = inicios.OWNER;
    revisar("propietario: máximo cuatro indicadores, sin la lista de vencidas repetida, con situación crítica y ligas a Indicadores y Reportes",
      dueno.resumen.length <= 4 && !dueno.bloques.some((b) => b.id === "vencidas") && dueno.masDetalle.map((d) => d.href).join() === "/indicadores,/reports" &&
      accionesRapidasDe("OWNER").some((a) => a.href === "#situacion-critica"));
    const indicadoresDueno = await pagina("/indicadores", c.OWNER);
    const indicadoresConsulta = await pagina("/indicadores", c.VIEWER);
    revisar("    las gráficas y el desglose que salieron del inicio están en Indicadores (no se perdió nada)",
      indicadoresDueno.texto.includes("Tendencias y desglose") && !(await pagina("/dashboard", c.OWNER)).texto.includes("Tendencias y desglose") && indicadoresConsulta.status === 200);
    const compras = inicios.COMPRAS;
    revisar("compras: accesos a requisiciones, preparar compra, entregas, proveedores y almacén",
      ["/requisiciones", "/suppliers", "/inventory"].every((h) => compras.acciones.some((a) => a.href.startsWith(h))));
    const avisos = await Promise.all(ROLES.map((r) => pagina("/notificaciones", c[r])));
    revisar("avisos: la pantalla abre para los siete roles", avisos.every((r) => r.status === 200 && !r.texto.includes(SIN_PERMISO)), avisos.map((r) => r.status));

    // Aceptar
    const ot4 = await prisma.workOrder.create({ data: { organizationId: A.id, number: `OT-9${sello.slice(-6)}`, title: "Aceptar", maintenanceType: "INSPECTION", status: "ASSIGNED", assignedToId: u.TECHNICIAN.id, assetId: equipo.id, estimatedHours: 1 } });
    await avisarNuevaOrden(A.id, ot4.id);
    const ac1 = await Promise.all([1, 2].map(() => pedir("POST", `/api/work-orders/${ot4.id}/aceptar`, c.TECHNICIAN)));
    const ajeno = await pedir("POST", `/api/work-orders/${ot4.id}/aceptar`, c.SUPERVISOR);
    const avisoAsig = await prisma.notification.findFirst({ where: { userId: u.TECHNICIAN.id, tipo: "OT_ASIGNADA", entidadId: ot4.id } });
    revisar("aceptar: el responsable la acepta una sola vez (queda en la bitácora y reconoce su aviso, que sigue pendiente hasta iniciarla); otro no puede",
      ac1.map((r) => r.status).sort().join() === "200,201" && ajeno.status === 403 &&
      (await prisma.workOrderComment.count({ where: { workOrderId: ot4.id, body: "Aceptó la orden." } })) === 1 &&
      Boolean(avisoAsig?.read) && !avisoAsig?.atendidaEl && (await prisma.workOrder.findUniqueOrThrow({ where: { id: ot4.id } })).status === "ASSIGNED",
      { ac1: ac1.map((r) => r.status), ajeno: ajeno.status });

    // QR
    const { resolverCodigo } = await import("../lib/qr");
    const origen = base;
    const puntoA = await puntoDeActivo(A.id, equipo.id, u.OWNER.id);
    const tecU = await prisma.user.findUniqueOrThrow({ where: { id: u.TECHNICIAN.id } });
    const solU = await prisma.user.findUniqueOrThrow({ where: { id: u.REQUESTER.id } });
    const q1 = await resolverCodigo(tecU, `${origen}/reportar/${puntoA.token}`, origen);
    const q2 = await resolverCodigo(solU, `${origen}/reportar/${puntoA.token}`, origen);
    const q3 = await resolverCodigo({ ...duenoB }, `${origen}/reportar/${puntoA.token}`, origen);
    const q4 = await resolverCodigo(tecU, "https://ejemplo.com/promo", origen);
    const q5 = await resolverCodigo(tecU, "val-7", origen);
    const q6 = await resolverCodigo(tecU, ot4.number.toLowerCase(), origen);
    const q7 = await pedir("GET", `/api/qr?codigo=${encodeURIComponent(`${origen}/reportar/${puntoA.token}`)}`, c.TECHNICIAN);
    revisar("QR: el técnico abre el equipo; el solicitante, el reporte con su usuario; otra empresa y un código ajeno se rechazan con motivo; clave y folio escritos también sirven",
      "destino" in q1 && q1.destino === `/assets/${equipo.id}` && "destino" in q2 && q2.destino === `/reportar/${puntoA.token}` &&
      "error" in q3 && "error" in q4 && /no es de MainTrack/.test(q4.error) && "destino" in q5 && q5.destino === `/assets/${equipo.id}` &&
      "destino" in q6 && q6.destino === `/work-orders/${ot4.id}` && q7.status === 200 && q7.json.destino === `/assets/${equipo.id}`,
      { q1, q2, q3, q4, q5, q6 });

    // Doble envío en lo que faltaba
    // Un medidor con su última lectura de hace tres días: 25 h de uso es posible.
    const hace3 = new Date(Date.now() - 3 * DIA);
    const medidor2 = await prisma.meter.create({ data: { organizationId: A.id, assetId: equipo.id, name: "Contador", unit: "h", currentValue: 100, lastReadingAt: hace3 } });
    await prisma.meterReading.create({ data: { organizationId: A.id, meterId: medidor2.id, value: 100, readingAt: hace3 } });
    const lect = await Promise.all([1, 2].map(() => pedir("POST", "/api/readings", c.TECHNICIAN, { meterId: medidor2.id, value: 125 })));
    const sols = await Promise.all([1, 2].map(() => pedir("POST", "/api/requests", c.REQUESTER, { title: "Se fue la luz del pasillo 3" })));
    const pr2 = await prisma.purchaseRequest.create({ data: { organizationId: A.id, folio: `RC2-${sello}`, warehouseId: almacen.id, solicitanteId: u.COMPRAS.id, estado: "SOLICITADA", montoEstimado: 100 } });
    const firmasDobles = await Promise.all([1, 2].map(() => pedir("POST", `/api/compras/${pr2.id}`, c.OWNER, { accion: "AUTORIZAR" })));
    const ot5 = await prisma.workOrder.create({ data: { organizationId: A.id, number: `OT5-${sello}`, title: "Terminar dos veces", maintenanceType: "INSPECTION", status: "IN_PROGRESS", startedAt: new Date(), assignedToId: u.TECHNICIAN.id, assetId: equipo.id, estimatedHours: 1 } });
    await pedir("POST", `/api/work-orders/${ot5.id}/labor`, c.TECHNICIAN, { hours: 1 });
    const terminar = await Promise.all([1, 2].map(() => pedir("POST", `/api/work-orders/${ot5.id}/status`, c.TECHNICIAN, { status: "COMPLETED", resolution: "Listo sin novedad", motivoSinDiagnostico: "Inspección" })));
    revisar("doble envío: lectura, solicitud, autorización de compra y terminar la OT cuentan una sola vez",
      lect.map((r) => r.status).sort().join() === "201,409" && (await prisma.meterReading.count({ where: { meterId: medidor2.id, value: 125 } })) === 1 &&
      sols.map((r) => r.status).sort().join() === "201,409" && (await prisma.workRequest.count({ where: { organizationId: A.id, title: "Se fue la luz del pasillo 3" } })) === 1 &&
      firmasDobles.filter((r) => r.status === 200).length === 1 && (await prisma.auditLog.count({ where: { organizationId: A.id, entityId: pr2.id, action: "AUTORIZAR" } })) === 1 &&
      (await prisma.auditLog.count({ where: { organizationId: A.id, entityId: ot5.id, action: "STATUS_CHANGED" } })) === 1 &&
      (await prisma.notification.count({ where: { tipo: "OT_LISTA_REVISION", entidadId: ot5.id, userId: u.SUPERVISOR.id } })) === 1,
      { lect: lect.map((r) => r.status), sols: sols.map((r) => r.status), firmas: firmasDobles.map((r) => r.status), terminar: terminar.map((r) => r.status) });
    const vistaSup5 = await pagina(`/work-orders/${ot5.id}`, c.SUPERVISOR);
    revisar("sincronización: supervisión ve en su pantalla, en ese momento, la orden terminada y lista para cerrar",
      vistaSup5.texto.includes("Completada") && vistaSup5.texto.includes("Validar y cerrar"));

    // ═══════════════════════════════════════════ 42-44: empresas y archivos
    console.log("\n42-44. Empresas y archivos");
    const cOperador = await sesion(operador, { actingOrganizationId: A.id });
    const cFalso = await sesion(duenoB, { actingOrganizationId: A.id });
    const enA = await pagina("/dashboard", cOperador);
    const falso = await pedir("GET", `/api/work-orders/${ot2.id}`, cFalso);
    revisar("42. cambio de empresa autorizado: el operador entra a la empresa cliente y se le dice dónde está",
      enA.status === 200 && enA.texto.includes("Esta viendo los datos de") && enA.texto.includes(A.name));
    const cruce = await Promise.all([pedir("GET", `/api/work-orders/${ot2.id}`, cB), pagina(`/work-orders/${ot2.id}`, cB)]);
    revisar("43. otra empresa no llega (404), ni poniendo la empresa ajena en la sesión sin ser operador", cruce[0].status === 404 && cruce[1].status === 404 && falso.status === 404, [cruce[0].status, cruce[1].status, falso.status]);
    const archivoAjeno = await fetch(`${base}/api/attachments/${adjuntoB.id}`, { headers: c.OWNER, redirect: "manual" });
    const subirAjeno = await pedir("POST", "/api/attachments", c.OWNER, { workOrderId: otB.id, name: "x.png", mimeType: "image/png", size: 10 });
    revisar("44. archivo de otra empresa: ni se abre ni se le cuelga nada (404)", archivoAjeno.status === 404 && subirAjeno.status === 404, [archivoAjeno.status, subirAjeno.status]);
  } finally {
    for (const id of [...creadas].reverse()) await prisma.organization.delete({ where: { id } }).catch((e) => console.error("no se borró", id, e));
    if (servidor?.pid) { try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya terminó */ } }
  }

  console.log("\nAislamiento de la prueba");
  revisar("las demás empresas quedaron exactamente como estaban", antes === await foto());
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
