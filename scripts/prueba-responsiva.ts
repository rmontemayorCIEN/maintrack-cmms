/**
 * Bloque 6 — lo que solo se ve en un navegador de verdad.
 *
 * Maneja un Chrome sin ventana por el protocolo de DevTools (sin
 * dependencias: WebSocket de Node) contra el build de PRODUCCIÓN (next start),
 * con la sesión de cada rol, en 320, 360, 390, 430, 768, 1024 y 1440 px y en
 * horizontal. Revisa:
 *
 *  - que ninguna página se desplace de lado ni tenga controles fuera de la pantalla;
 *  - tablas como tarjetas en el teléfono; menú, barra inferior y cajón;
 *  - la ventana de reporte en 320 px, con el teclado abierto (pantalla corta);
 *  - sin conexión a media captura: se avisa, no se pierde, y se envía al volver;
 *  - regresar con «atrás» a una lista filtrada;
 *  - consola sin errores y ninguna petición fallida;
 *  - rendimiento con red 4G simulada.
 *
 * Requiere un build previo (npm run build) y el servidor de desarrollo
 * detenido. Deja capturas en SALIDA_CAPTURAS (o en /tmp).
 *
 *   npx tsx scripts/prueba-responsiva.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}
process.env.AUTH_SECRET = llaveDeSesion();

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 400)}` : ""}`);
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAPTURAS = process.env.SALIDA_CAPTURAS ?? join(tmpdir(), "maintrack-capturas");

// ─────────────────────────────────────────── Un cliente mínimo de DevTools

type Evento = { method: string; params: Record<string, unknown> };
class Pestana {
  private id = 0;
  private pendientes = new Map<number, { ok: (v: unknown) => void; mal: (e: Error) => void }>();
  private oyentes: Array<(e: Evento) => void> = [];
  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && this.pendientes.has(d.id)) {
        const p = this.pendientes.get(d.id)!;
        this.pendientes.delete(d.id);
        if (d.error) p.mal(new Error(d.error.message)); else p.ok(d.result);
      } else if (d.method) for (const o of this.oyentes) o(d);
    });
  }
  static async abrir(url: string) {
    const ws = new WebSocket(url);
    await new Promise((r, x) => { ws.addEventListener("open", r); ws.addEventListener("error", x); });
    return new Pestana(ws);
  }
  enviar<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, mal) => this.pendientes.set(id, { ok: ok as (v: unknown) => void, mal }));
  }
  al(f: (e: Evento) => void) { this.oyentes.push(f); }
  async evaluar<T>(expresion: string): Promise<T> {
    const r = await this.enviar<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression: expresion, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Error al evaluar: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
    return r.result.value;
  }
  async ir(url: string, espera = 700) {
    const cargada = new Promise<void>((r) => {
      const f = (e: Evento) => { if (e.method === "Page.loadEventFired") r(); };
      this.al(f);
    });
    await this.enviar("Page.navigate", { url });
    await Promise.race([cargada, esperar(30_000)]);
    await esperar(espera); // hidratación
  }
  cerrar() { this.ws.close(); }
}

const MEDIDA = `(() => {
  const ancho = window.innerWidth;
  const doc = document.documentElement;
  const desborde = doc.scrollWidth > ancho + 1;
  const visibles = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const fuera = [...document.querySelectorAll("a,button,input,select,textarea")].filter((e) => {
    if (!visibles(e)) return false;
    // Lo que se desliza dentro de su propio contenedor (índice, tablas) no cuenta.
    // Lo que queda RECORTADO por un contenedor con overflow oculto sí: está cortado.
    for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return false; }
    const r = e.getBoundingClientRect(); return r.right > ancho + 1 || r.left < -1;
  }).map((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40));
  // Bloques de contenido que se salen del ancho (aunque un contenedor los recorte).
  const cortados = [...document.querySelectorAll("main section, main .card, main li, main h1, main dl")].filter((e) => {
    if (!visibles(e)) return false;
    for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return false; }
    return e.getBoundingClientRect().right > ancho + 1;
  }).map((e) => (e.id || e.className || e.tagName).toString().slice(0, 50));
  fuera.push(...cortados.slice(0, 3).map((c) => "bloque cortado: " + c));
  const chicos = ancho < 768 ? [...document.querySelectorAll("main a, main button, nav a, nav button, main input, main select")].filter((e) => {
    if (!visibles(e)) return false; const r = e.getBoundingClientRect();
    if (e.closest("p, li p, dd, td") && e.tagName === "A") return false; // ligas dentro de un texto
    return r.height < 32 || r.width < 32;
  }).map((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30)) : [];
  const barra = document.querySelector('nav[aria-label="Accesos principales"]');
  return {
    desborde, anchoDoc: doc.scrollWidth, ancho, fuera: fuera.slice(0, 6), chicos: [...new Set(chicos)].slice(0, 8), nChicos: chicos.length,
    sinPermiso: document.body.innerText.includes("Esta pantalla no es de su rol"),
    barra: !!barra && getComputedStyle(barra).display !== "none",
    titulo: (document.querySelector("h1")?.textContent || "").trim().slice(0, 60),
    errorPagina: document.body.innerText.includes("Application error") || document.body.innerText.includes("This page could not be found"),
  };
})()`;

async function main() {
  const { prisma } = await import("../lib/db");
  const { puntoDeActivo } = await import("../lib/portal");
  const { aplicarMovimiento } = await import("../lib/almacen");
  mkdirSync(CAPTURAS, { recursive: true });

  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3207";
  if (!process.env.BASE_URL) servidor = spawn("npx", ["next", "start", "-p", "3207", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  const perfil = join(tmpdir(), `mt-chrome-${Date.now()}`);
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: "ignore" });

  const sello = `rs-${Date.now()}`;
  const creadas: string[] = [];
  const DIA = 86_400_000;
  try {
    // ── Datos: una empresa exclusiva con algo en cada pantalla.
    const A = await prisma.organization.create({ data: { name: `${sello} Planta Norte`, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5,6,7" } });
    creadas.push(A.id);
    const persona = (rol: string, nombre: string) => prisma.user.create({ data: { organizationId: A.id, email: `${nombre.toLowerCase()}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x" } });
    const u = {
      OWNER: await persona("OWNER", "Dueño Prueba"), ADMIN: await persona("ADMIN", "Admin Prueba"), SUPERVISOR: await persona("SUPERVISOR", "Sup Prueba"),
      TECHNICIAN: await persona("TECHNICIAN", "Técnico Prueba"), COMPRAS: await persona("COMPRAS", "Compras Prueba"),
      REQUESTER: await persona("REQUESTER", "Solicitante Prueba"), VIEWER: await persona("VIEWER", "Consulta Prueba"),
    };
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "PN", name: "Planta Norte" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM", name: "Almacén general", esGeneral: true } });
    const activos = [];
    for (let i = 1; i <= 12; i++) {
      activos.push(await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: `BOM-${String(i).padStart(3, "0")}`, name: `Bomba centrífuga de alimentación de agua ${i}`, serialNumber: `SN-${1000 + i}`, manufacturer: "Grundfos", model: "CR 32-2 A-F-A-E-HQQE", criticality: i % 3 === 0 ? "A" : "B" } }));
    }
    const medidor = await prisma.meter.create({ data: { organizationId: A.id, assetId: activos[0].id, name: "Horómetro", unit: "h", currentValue: 1520, lastReadingAt: new Date(Date.now() - 3 * DIA) } });
    void medidor;
    const parte = await prisma.part.create({ data: { organizationId: A.id, code: `RD-${sello}`, name: "Rodamiento de bolas 6205-2RS", unit: "pza", unitCost: 120, minQuantity: 5 } });
    await aplicarMovimiento({ organizationId: A.id, partId: parte.id, warehouseId: almacen.id, tipo: "IN", cantidad: 3, costoUnitario: 120, userId: u.OWNER.id, referencia: "Inicial" });
    const ots = [];
    for (let i = 1; i <= 14; i++) {
      ots.push(await prisma.workOrder.create({
        data: {
          organizationId: A.id, number: `OT-${String(i).padStart(6, "0")}`, title: `Cambiar sello mecánico y revisar alineación del acoplamiento ${i}`,
          maintenanceType: i % 2 ? "CORRECTIVE" : "PREVENTIVE", priority: i === 1 ? "CRITICAL" : i % 3 ? "MEDIUM" : "HIGH",
          status: i < 4 ? "IN_PROGRESS" : i < 10 ? "ASSIGNED" : "OPEN", startedAt: i < 4 ? new Date() : null,
          assetId: activos[i % activos.length].id, siteId: sitio.id, assignedToId: i < 10 ? u.TECHNICIAN.id : null,
          dueDate: new Date(Date.now() + (i - 5) * DIA), estimatedHours: 2 + (i % 3),
          safetyNotes: i === 1 ? "Bloqueo y etiquetado antes de abrir la bomba" : null,
          tasks: { create: [{ title: "Aislar y bloquear energía", position: 0 }, { title: "Cambiar sello", position: 1 }, { title: "Probar sin fugas", position: 2, taskType: "MEASUREMENT", unit: "bar", minValue: 2, maxValue: 6 }] },
        },
      }));
    }
    const otTec = ots[3]; // asignada, sin iniciar
    const solicitudes = [];
    for (let i = 1; i <= 4; i++) {
      solicitudes.push(await prisma.workRequest.create({ data: { organizationId: A.id, number: `SOL-${i}`, title: `Gotea agua en el área de lavado ${i}`, requestedById: u.REQUESTER.id, assetId: activos[i].id } }));
    }
    const compra = await prisma.purchaseRequest.create({
      data: { organizationId: A.id, folio: `RC-${sello}`, warehouseId: almacen.id, solicitanteId: u.COMPRAS.id, estado: "SOLICITADA", montoEstimado: 480, justificacion: "Reponer rodamientos bajo mínimo",
        renglones: { create: [{ partId: parte.id, descripcion: "Rodamiento 6205-2RS", cantidadSolicitada: 4, costoEstimado: 120 }] } },
    });
    await prisma.supplier.create({ data: { organizationId: A.id, name: "Rodamientos del Norte, S.A. de C.V." } });
    const punto = await puntoDeActivo(A.id, activos[0].id, u.OWNER.id);

    // ── Chrome y servidor.
    const finEspera = Date.now() + 120_000;
    let wsNavegador = "";
    while (!wsNavegador && Date.now() < finEspera) {
      try { wsNavegador = ((await (await fetch("http://127.0.0.1:9333/json/version")).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl; } catch { await esperar(500); }
    }
    for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/login`); if (r.status < 500) break; } catch { /* aún no */ } await esperar(1000); }
    const nav = await Pestana.abrir(wsNavegador);
    const { targetId } = await nav.enviar<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const lista = (await (await fetch("http://127.0.0.1:9333/json/list")).json()) as Array<{ id: string; webSocketDebuggerUrl: string }>;
    const t = await Pestana.abrir(lista.find((x) => x.id === targetId)!.webSocketDebuggerUrl);
    await t.enviar("Page.enable"); await t.enviar("Runtime.enable"); await t.enviar("Network.enable"); await t.enviar("Log.enable");

    const errores: Array<{ donde: string; que: string }> = [];
    const fallidas: Array<{ donde: string; url: string; status: number }> = [];
    let donde = "";
    let permitidos4xx = new Set<number>();
    t.al((e) => {
      if (e.method === "Runtime.exceptionThrown") errores.push({ donde, que: JSON.stringify(e.params).slice(0, 200) });
      if (e.method === "Runtime.consoleAPICalled" && (e.params as { type: string }).type === "error") errores.push({ donde, que: JSON.stringify((e.params as { args: unknown[] }).args).slice(0, 200) });
      if (e.method === "Log.entryAdded" && (e.params as { entry: { level: string } }).entry.level === "error") {
        const entrada = (e.params as { entry: { text: string; url?: string } }).entry;
        if (!/net::ERR_INTERNET_DISCONNECTED|Failed to load resource: the server responded with a status of 40[39]/.test(entrada.text)) errores.push({ donde, que: `${entrada.text} ${entrada.url ?? ""}`.slice(0, 200) });
      }
      if (e.method === "Network.responseReceived") {
        const r = (e.params as { response: { status: number; url: string } }).response;
        if (r.status >= 500 || (r.status >= 400 && !permitidos4xx.has(r.status))) fallidas.push({ donde, url: r.url.replace(base, ""), status: r.status });
      }
    });

    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const sesion = async (rol: keyof typeof u | null) => {
      await t.enviar("Network.clearBrowserCookies");
      if (!rol) return;
      const x = u[rol];
      const jwt = await new SignJWT({ userId: x.id, organizationId: A.id, email: x.email, name: x.name, role: x.role }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);
      await t.enviar("Network.setCookie", { name: "mt_session", value: jwt, url: base, httpOnly: true });
    };
    const pantalla = async (ancho: number, alto: number) => {
      await t.enviar("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 2, mobile: ancho < 768 });
      await t.enviar("Emulation.setTouchEmulationEnabled", { enabled: ancho < 1024 });
    };
    const captura = async (nombre: string) => {
      const { data } = await t.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(data, "base64"));
    };
    type Medida = { desborde: boolean; anchoDoc: number; ancho: number; fuera: string[]; chicos: string[]; nChicos: number; sinPermiso: boolean; barra: boolean; titulo: string; errorPagina: boolean };
    const medir = () => t.evaluar<Medida>(MEDIDA);

    // ═══════════════════════════════════════════ 1-14: roles × anchos
    console.log("\n1-14. Cada rol en cada ancho");
    const PANTALLAS: Record<keyof typeof u, string[]> = {
      OWNER: ["/dashboard", "/work-orders", `/work-orders/${ots[0].id}`, "/assets", "/compras", "/settings", "/indicadores"],
      ADMIN: ["/dashboard", "/settings?s=usuarios", "/inventory", "/puesta-en-marcha", "/plans"],
      SUPERVISOR: ["/dashboard", "/work-orders", `/work-orders/${ots[0].id}`, "/calendar", "/requests", "/board", "/backlog"],
      TECHNICIAN: ["/dashboard", "/work-orders?mias=1", `/work-orders/${otTec.id}`, "/escanear", `/assets/${activos[0].id}`, "/search?q=bomba", "/notificaciones"],
      COMPRAS: ["/dashboard", "/compras", `/compras/${compra.id}`, "/requisiciones", "/inventory", "/suppliers"],
      REQUESTER: ["/dashboard", "/requests", `/requests/${solicitudes[0].id}`, "/escanear", `/reportar/${punto.token}`],
      VIEWER: ["/dashboard", "/search?q=bom", "/assets", "/reports", "/work-orders"],
    };
    const ANCHOS: Array<[number, number, string]> = [[320, 640, "320"], [360, 740, "360"], [390, 844, "390"], [430, 932, "430"], [768, 1024, "768"], [1024, 768, "1024"], [1440, 900, "escritorio"]];
    const problemas: Record<string, Array<Record<string, unknown>>> = {};
    const porAncho: Record<string, number> = {};
    for (const [ancho, alto, etiqueta] of ANCHOS) {
      await pantalla(ancho, alto);
      problemas[etiqueta] = [];
      porAncho[etiqueta] = 0;
      for (const rol of Object.keys(PANTALLAS) as Array<keyof typeof u>) {
        await sesion(rol);
        // En 320, 390 y escritorio, todas las pantallas del rol; en los demás anchos, las tres principales.
        const rutas = ["320", "390", "escritorio"].includes(etiqueta) ? PANTALLAS[rol] : PANTALLAS[rol].slice(0, 3);
        for (const ruta of rutas) {
          donde = `${rol} ${etiqueta} ${ruta}`;
          permitidos4xx = new Set();
          await t.ir(`${base}${ruta}`);
          const m = await medir();
          porAncho[etiqueta]++;
          // El portal del QR es público (fuera de la aplicación): no lleva la barra de navegación.
          const conBarra = !ruta.startsWith("/reportar/");
          if (m.desborde || m.fuera.length || m.sinPermiso || m.errorPagina || (ancho < 768 && conBarra && !m.barra)) {
            problemas[etiqueta].push({ rol, ruta, desborde: m.desborde ? `${m.anchoDoc}>${m.ancho}` : undefined, fuera: m.fuera.length ? m.fuera : undefined, sinPermiso: m.sinPermiso || undefined, error: m.errorPagina || undefined, barra: ancho < 768 ? m.barra : undefined });
          }
          if (etiqueta === "390" && m.nChicos) problemas["390-tactiles"] = [...(problemas["390-tactiles"] ?? []), { rol, ruta, chicos: m.chicos }];
        }
      }
      revisar(`${8 + ANCHOS.findIndex((a) => a[2] === etiqueta)}. ${etiqueta === "escritorio" ? "Escritorio (1440 px)" : `${etiqueta} px`}: ${porAncho[etiqueta]} pantallas de los 7 roles sin desplazamiento lateral, sin controles fuera, sin «Sin permiso» en las propias`,
        problemas[etiqueta].length === 0, problemas[etiqueta].slice(0, 4));
    }
    const tactiles = problemas["390-tactiles"] ?? [];
    console.log(`  info  controles táctiles menores de 32 px en 390 px: ${tactiles.reduce((s, x) => s + (x.chicos as string[]).length, 0)} distintos en ${tactiles.length} pantallas`, JSON.stringify(tactiles.slice(0, 6)).slice(0, 600));

    // ═══════════════════════════════════════════ Capturas de referencia
    await pantalla(390, 844);
    await sesion("TECHNICIAN");
    await t.ir(`${base}/dashboard`); await captura("390-tecnico-inicio");
    await t.ir(`${base}/work-orders/${otTec.id}`); await captura("390-tecnico-orden");
    await sesion("REQUESTER"); await t.ir(`${base}/dashboard`); await captura("390-solicitante-inicio");
    await sesion("COMPRAS"); await t.ir(`${base}/dashboard`); await captura("390-compras-inicio");
    await pantalla(1440, 900);
    await sesion("OWNER"); await t.ir(`${base}/dashboard`, 2500); await captura("1440-dueno-inicio");
    await sesion("SUPERVISOR"); await t.ir(`${base}/dashboard`); await captura("1440-supervisor-inicio");

    // ═══════════════════════════════════════════ 16: menú en el teléfono
    console.log("\n16. Menú en el teléfono");
    await pantalla(390, 844);
    await sesion("REQUESTER");
    donde = "menu";
    await t.ir(`${base}/requests`);
    const menu = await t.evaluar<{ abierto: boolean; ligas: string[]; cerrado: boolean; conserva: boolean }>(`(async () => {
      const campo = document.querySelector("main input, main textarea");
      const barra = document.querySelector('nav[aria-label="Accesos principales"]');
      [...barra.querySelectorAll("button")].find((b) => b.textContent.includes("Menú")).click();
      await new Promise((r) => setTimeout(r, 300));
      const cajon = document.querySelector('[role="dialog"][aria-label="Menú"]');
      const ligas = cajon ? [...cajon.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await new Promise((r) => setTimeout(r, 300));
      return { abierto: !!cajon, ligas, cerrado: !document.querySelector('[role="dialog"][aria-label="Menú"]'), conserva: location.pathname === "/requests" };
    })()`);
    revisar("16. el botón «Menú» de la barra abre el cajón con solo las pantallas del rol, y Escape lo cierra sin salir de la pantalla",
      menu.abierto && menu.cerrado && menu.conserva && !menu.ligas.some((h) => ["/inventory", "/compras", "/work-orders"].includes(h)), menu);

    // ═══════════════════════════════════════════ 47, 46, 38, 40: la ventana de reporte en 320 px
    console.log("\n38, 40, 46, 47. El reporte en un teléfono de 320 px");
    await pantalla(320, 568);
    donde = "reporte-320";
    await t.ir(`${base}/requests?nueva=1`, 1200);
    const modal = await t.evaluar<{ hay: boolean; cabe: boolean; boton: boolean; desborde: boolean }>(`(() => {
      const d = document.querySelector('[role="dialog"] form');
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Enviar reporte"));
      const r = d?.getBoundingClientRect(); const rb = b?.getBoundingClientRect();
      return { hay: !!d, cabe: !!r && r.height <= innerHeight + 1 && r.width <= innerWidth + 1, boton: !!rb && rb.bottom <= innerHeight && rb.top >= 0, desborde: document.documentElement.scrollWidth > innerWidth + 1 };
    })()`);
    revisar("47. la ventana de reporte cabe en 320 × 568 (se desliza por dentro) y el botón de enviar está a la vista", modal.hay && modal.cabe && modal.boton && !modal.desborde, modal);
    await captura("320-reporte");
    // Teclado abierto: la pantalla útil se reduce a la mitad.
    await pantalla(320, 300);
    const teclado = await t.evaluar<{ boton: boolean; enfocado: boolean }>(`(async () => {
      const campo = document.querySelector("#sol-que"); campo.focus(); campo.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 200));
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Enviar reporte"));
      const rb = b.getBoundingClientRect(); const rc = campo.getBoundingClientRect();
      return { boton: rb.bottom <= innerHeight + 1 && rb.top >= 0, enfocado: document.activeElement === campo && rc.top >= 0 && rc.bottom <= innerHeight };
    })()`);
    revisar("46. con el teclado abierto (pantalla de 300 px de alto), el campo activo y «Enviar reporte» siguen visibles", teclado.boton && teclado.enfocado, teclado);
    await pantalla(320, 568);
    // Sin conexión a media captura.
    await t.evaluar(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      const campo = document.querySelector("#sol-que"); set.call(campo, "Fuga de agua en la tubería del baño"); campo.dispatchEvent(new Event("input", { bubbles: true }));
      const lugar = document.querySelector("#sol-donde"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(lugar, "Baño de hombres, planta baja"); lugar.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await esperar(300);
    await t.enviar("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    donde = "sin-conexion";
    const sinRed = await t.evaluar<{ aviso: boolean; error: string; conservado: string; borrador: boolean }>(`(async () => {
      window.dispatchEvent(new Event("offline"));
      [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Enviar reporte")).click();
      await new Promise((r) => setTimeout(r, 800));
      return {
        aviso: document.body.innerText.includes("Sin conexión"),
        error: document.querySelector('[role="alert"]')?.textContent ?? "",
        conservado: document.querySelector("#sol-que").value,
        borrador: (sessionStorage.getItem("mt_borrador:solicitud-nueva") || "").includes("Fuga de agua"),
      };
    })()`);
    revisar("40. sin conexión a media captura: se avisa que no se guardó, lo escrito se queda (también en el borrador de la pestaña)",
      sinRed.aviso && /no se guardó/i.test(sinRed.error) && sinRed.conservado.startsWith("Fuga de agua") && sinRed.borrador, sinRed);
    await t.enviar("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    donde = "reconexion";
    const alVolver = await t.evaluar<{ enviado: boolean }>(`(async () => {
      window.dispatchEvent(new Event("online"));
      [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Enviar reporte")).click();
      for (let i = 0; i < 40 && !document.body.innerText.includes("enviado"); i++) await new Promise((r) => setTimeout(r, 250));
      return { enviado: document.body.innerText.includes("enviado") };
    })()`);
    const creado = await prisma.workRequest.findFirst({ where: { organizationId: A.id, title: "Fuga de agua en la tubería del baño" } });
    revisar("    al volver la señal se envía lo mismo, una sola vez, con el lugar", alVolver.enviado && Boolean(creado?.description?.includes("Baño de hombres")) &&
      (await prisma.workRequest.count({ where: { organizationId: A.id, title: "Fuga de agua en la tubería del baño" } })) === 1, alVolver);
    // Error de validación: un título de dos letras no se manda; lo escrito se queda y el foco va al campo.
    donde = "validacion";
    await t.ir(`${base}/requests?nueva=1`, 1200);
    await t.evaluar(`(() => { const c = document.querySelector("#sol-que"); c.value = ""; c.focus(); })()`);
    await t.enviar("Input.insertText", { text: "ab" }); // tecleado de verdad: la validación del navegador solo mira lo tecleado
    const validacion = await t.evaluar<{ enfocado: boolean; conservado: string; invalido: boolean }>(`(async () => {
      const campo = document.querySelector("#sol-que");
      document.querySelector("#sol-donde").focus();
      await new Promise((r) => setTimeout(r, 100));
      [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Enviar reporte")).click();
      await new Promise((r) => setTimeout(r, 300));
      return { enfocado: document.activeElement === campo, conservado: campo.value, invalido: !campo.checkValidity() };
    })()`);
    revisar("38. formulario con error de validación: no se envía, el foco va al campo con el error y lo escrito se queda", validacion.invalido && validacion.enfocado && validacion.conservado === "ab", validacion);

    // ═══════════════════════════════════════════ 48, 45: tablas como tarjetas y regresar sin perder contexto
    console.log("\n45 y 48. Tarjetas y regresar");
    await pantalla(390, 844);
    await sesion("SUPERVISOR");
    donde = "tarjetas";
    await t.ir(`${base}/work-orders`);
    const movil = await t.evaluar<{ tarjetas: number; tablaVisible: boolean; conFolio: boolean }>(`(() => {
      const tabla = document.querySelector("table.data");
      const tarjetas = [...document.querySelectorAll("ul > li")].filter((li) => li.textContent.includes("OT-0000") && li.getBoundingClientRect().width > 0);
      return { tarjetas: tarjetas.length, tablaVisible: !!tabla && tabla.getBoundingClientRect().width > 0, conFolio: tarjetas.some((t) => t.textContent.includes("Estado") || t.textContent.includes("Prioridad")) };
    })()`);
    await captura("390-supervisor-ordenes-tarjetas");
    await pantalla(1440, 900);
    await t.ir(`${base}/work-orders`);
    const escritorio = await t.evaluar<{ tablaVisible: boolean }>(`(() => { const t = document.querySelector("table.data"); return { tablaVisible: !!t && t.getBoundingClientRect().width > 0 }; })()`);
    revisar("48. la lista de órdenes es tarjetas en el teléfono (con estado y prioridad) y tabla en escritorio", movil.tarjetas >= 10 && !movil.tablaVisible && movil.conFolio && escritorio.tablaVisible, { movil, escritorio });
    await pantalla(390, 844);
    await t.ir(`${base}/work-orders`);
    donde = "atras";
    const atras = await t.evaluar<{ url: string }>(`(async () => {
      const f = document.querySelector('input[aria-label="Filtrar la lista"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, "acoplamiento 1"); f.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      return { url: location.search };
    })()`);
    const liga = await t.evaluar<string>(`(() => { const a = [...document.querySelectorAll("ul a[href^='/work-orders/']")].find((x) => x.getBoundingClientRect().width > 0); return a ? a.getAttribute("href") : ""; })()`);
    await t.ir(`${base}${liga}`);
    await t.enviar("Page.navigateToHistoryEntry", { entryId: (await t.enviar<{ currentIndex: number; entries: Array<{ id: number }> }>("Page.getNavigationHistory")).entries.at(-2)!.id });
    await esperar(1500);
    const regreso = await t.evaluar<{ valor: string; url: string }>(`(() => ({ valor: document.querySelector('input[aria-label="Filtrar la lista"]')?.value ?? "", url: location.pathname + location.search }))()`);
    revisar("45. regresar con «atrás» a la lista la deja filtrada como estaba", Boolean(liga) && atras.url.includes("f=") && regreso.valor === "acoplamiento 1" && regreso.url.startsWith("/work-orders?"), { atras, regreso, liga });

    // ═══════════════════════════════════════════ 49: horizontal, y la barra de acciones de la orden
    console.log("\n49. Horizontal y acciones de la orden");
    await sesion("TECHNICIAN");
    await pantalla(844, 390);
    donde = "horizontal";
    await t.ir(`${base}/work-orders/${otTec.id}`);
    const horizontal = await medir();
    await captura("844x390-tecnico-orden");
    await pantalla(390, 844);
    await t.ir(`${base}/work-orders/${otTec.id}`);
    const vertical = await medir();
    const accion = await t.evaluar<{ visible: boolean; indice: string[]; ficha: boolean; costos: boolean }>(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Iniciar/.test(x.textContent) && x.getBoundingClientRect().width > 0);
      const r = b?.getBoundingClientRect();
      const indice = [...document.querySelectorAll('nav[aria-label="Secciones de la orden"] a')].map((a) => a.textContent.replace(/^\\d+\\./, ""));
      return { visible: !!r && r.bottom <= innerHeight && r.top >= innerHeight / 2, indice, ficha: document.body.innerText.includes("Lea las instrucciones") || document.body.innerText.includes("Actividades"), costos: document.body.innerText.includes("Costo total") };
    })()`);
    revisar("49. la orden en vertical y en horizontal, sin desplazamiento lateral", !horizontal.desborde && !vertical.desborde && !horizontal.fuera.length, { horizontal: horizontal.desborde, vertical: vertical.desborde });
    revisar("    en el teléfono: «Iniciar» fijo abajo al alcance del pulgar, índice del trabajo en orden, y sin costos para el técnico",
      accion.visible && accion.indice.join(",").startsWith("Actividades") && accion.indice.includes("Evidencias") && accion.ficha && !accion.costos, accion);

    // ═══════════════════════════════════════════ 35-36 (en pantalla) y rendimiento
    console.log("\nRendimiento en red móvil (4G simulada)");
    await t.enviar("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
    await t.enviar("Network.setCacheDisabled", { cacheDisabled: true });
    const rendimiento: Record<string, { ms: number; kb: number }> = {};
    for (const [rol, ruta] of [["TECHNICIAN", "/dashboard"], ["TECHNICIAN", `/work-orders/${otTec.id}`], ["REQUESTER", "/requests"], ["SUPERVISOR", "/dashboard"], ["OWNER", "/dashboard"]] as Array<[keyof typeof u, string]>) {
      await sesion(rol);
      let bytes = 0;
      const contar = (e: Evento) => { if (e.method === "Network.loadingFinished") bytes += (e.params as { encodedDataLength: number }).encodedDataLength; };
      t.al(contar);
      donde = `rendimiento ${rol} ${ruta}`;
      const inicio = Date.now();
      await t.ir(`${base}${ruta}`, 0);
      const ms = Date.now() - inicio;
      rendimiento[`${rol} ${ruta.replace(otTec.id, ":id")}`] = { ms, kb: Math.round(bytes / 1024) };
      await esperar(300);
    }
    await t.enviar("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    for (const [k, v] of Object.entries(rendimiento)) console.log(`  info  ${k}: ${v.ms} ms hasta cargar, ${v.kb} KB transferidos`);
    revisar("Las pantallas de trabajo cargan en menos de 5 s en 4G simulada (sin caché)", Object.values(rendimiento).every((v) => v.ms < 5000), rendimiento);

    // ═══════════════════════════════════════════ 50: consola y peticiones
    console.log("\n50. Consola y peticiones fallidas");
    revisar("50. sin errores en la consola en todo el recorrido", errores.length === 0, errores.slice(0, 5));
    revisar("    y ninguna petición fallida (4xx o 5xx)", fallidas.length === 0, fallidas.slice(0, 8));
    console.log(`\n  Capturas en ${CAPTURAS}`);
    t.cerrar(); nav.cerrar();
  } finally {
    for (const id of [...creadas].reverse()) await prisma.organization.delete({ where: { id } }).catch((e) => console.error("no se borró", id, e));
    try { chrome.kill("SIGTERM"); } catch { /* ya cerró */ }
    if (servidor?.pid) { try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya terminó */ } }
  }
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
