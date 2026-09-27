/**
 * Bloque 6 — lo que solo se ve en un navegador de verdad.
 *
 * Maneja un Chrome sin ventana por el protocolo de DevTools (sin
 * dependencias: WebSocket de Node) contra el build de PRODUCCIÓN (next start),
 * con la sesión de cada rol, en 320×568, 360×800, 390×844, 430×932, 768×1024,
 * 1024×768 y 1440×900, y en horizontal. Revisa:
 *
 *  - cada pantalla de cada rol y su menú (abierto y cerrado), con captura de
 *    las pantallas principales en cada tamaño; URL de otro rol rechazada;
 *  - «Escanear QR» con una cámara simulada que muestra un QR de MainTrack:
 *    permiso solo al tocar, cámara trasera, lectura con jsQR y nativa,
 *    cancelar, permiso negado, captura manual y código ajeno;
 *  - el recorrido completo del técnico en 390 px con el supervisor mirando
 *    desde otra sesión del navegador;
 *  - fotos: orientación, reducción, varias, repetidas, tipo y tamaño, falla de
 *    red con reintento, progreso, consulta posterior y aislamiento;
 *  - lo escrito sin enviar sobrevive a menú, activo y atrás, otra pestaña,
 *    recarga y falta de señal; conflicto de edición entre dos sesiones;
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
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { levantarServidor } from "./servidor-de-prueba";

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
  // Lo marcado aria-hidden (la trampa para robots de los formularios) no es para personas: no cuenta.
  const visibles = (e) => { if (e.closest('[aria-hidden="true"]')) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
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
    // Comentarios de codigo dibujados como texto.
    //
    // Paso de verdad: un comentario de bloque dentro del JSX —donde no es
    // comentario sino texto literal— se estuvo mostrando en la pantalla de
    // ordenes de trabajo, en produccion, durante dias. Compilaba, ninguna
    // prueba lo veia, y las capturas nadie las miro con esa pregunta en la
    // cabeza. Se revisa en TODAS las pantallas y roles, porque el error puede
    // nacer en cualquier componente compartido.
    comentario: (() => {
      const texto = document.body.innerText;
      const i = texto.indexOf("/*") >= 0 ? texto.indexOf("/*") : texto.indexOf("*/");
      return i >= 0 ? texto.slice(Math.max(0, i - 10), i + 70).replace(/\s+/g, " ") : "";
    })(),
  };
})()`;

async function main() {
  const { prisma } = await import("../lib/db");
  const { puntoDeActivo } = await import("../lib/portal");
  const { aplicarMovimiento } = await import("../lib/almacen");
  const { menuDe, puedeVerRuta } = await import("../lib/pantallas");
  const sharp = (await import("sharp")).default;
  const QRCode = (await import("qrcode")).default;
  mkdirSync(CAPTURAS, { recursive: true });

  let servidor: ChildProcess | null = null;
  let chrome: ChildProcess | null = null;

  /**
   * Puerto propio del SERVIDOR en cada corrida, por el mismo motivo que el de
   * Chrome —y costo mas caro todavia—.
   *
   * Con el puerto fijo 3207, un `next start` de una corrida interrumpida
   * seguia escuchando ahi. El `next start` nuevo fallaba en silencio por
   * puerto ocupado y la prueba se conectaba AL VIEJO, que sirve el build de
   * hace horas: el HTML pedia archivos de cliente que ese build ya no tiene,
   * el navegador tiraba ChunkLoadError y la pantalla mostraba «Application
   * error». Es decir, la prueba reprobaba un codigo correcto.
   *
   * Lo peor es como enganaba: fallaba solo en las pantallas cuyo archivo
   * habia cambiado desde ese build, asi que parecia senalar justo lo ultimo
   * que uno toco. Se persiguio medio dia un defecto que no existia.
   */
  const PUERTO_APP = 3400 + Math.floor(Math.random() * 400);
  const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO_APP}`;

  /**
   * Sin build de produccion esto NO puede correr, y hay que decirlo aqui.
   *
   * Esta prueba sirve la aplicacion con `next start`, que necesita el build de
   * produccion. Cualquier `next dev` posterior reescribe `.next` y se lleva el
   * BUILD_ID por delante —y la suite completa levanta trece servidores de
   * desarrollo—, asi que correr `npm run build` y despues la suite deja esto
   * sin nada que servir.
   *
   * Cuando pasaba, `next start` no levantaba, el navegador se quedaba en su
   * pagina de error de conexion, y la prueba reportaba TRECE fallas de
   * interfaz: «al menu de este rol le faltan todas sus pantallas». Se
   * persiguieron cuatro hipotesis falsas antes de mirar si habia build. La
   * interfaz estaba perfecta las cuatro veces.
   *
   * Una linea diciendo la verdad vale mas que trece fallas inventadas.
   */
  if (!process.env.BASE_URL && !existsSync(join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("\n  No hay build de produccion en .next, y esta prueba sirve la aplicacion con `next start`.");
    console.error("  Corra `npm run build` y vuelva a intentar.");
    console.error("  Ojo con el orden: un `next dev` posterior —o la suite completa, que levanta trece— lo borra.\n");
    process.exit(1);
  }

  if (!process.env.BASE_URL) {
    servidor = levantarServidor({ puerto: PUERTO_APP, modo: "start" });
  }
  const perfil = join(tmpdir(), `mt-chrome-${Date.now()}`);
  /**
   * Puerto propio de esta corrida, y limpieza de lo que haya quedado vivo.
   *
   * El defecto que costo medio dia: con un puerto fijo, un Chrome de una
   * corrida interrumpida seguia escuchando en el, y la corrida siguiente se
   * CONECTABA A ESE en vez de al suyo. Ese Chrome viejo apunta al video falso
   * de su corrida —un archivo temporal que ya se borro—, asi que la camara
   * simulada no entregaba un solo cuadro y la lectura del QR fallaba sin
   * explicacion. Pasaba o no segun si habia quedado basura, que es justo la
   * forma en que una prueba se vuelve «intermitente».
   */
  const PUERTO_CDP = 9400 + Math.floor(Math.random() * 400);

  const sello = `rs-${Date.now()}`;
  const ARCHIVOS = join(tmpdir(), `mt-archivos-${sello}`);
  mkdirSync(ARCHIVOS, { recursive: true });
  const creadas: string[] = [];
  let demoId: string | null = null;
  const DIA = 86_400_000;
  try {
    // ── Datos: una empresa exclusiva con algo en cada pantalla, y otra para el aislamiento.
    const A = await prisma.organization.create({ data: { name: `${sello} Planta Norte`, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5,6,7", registrosPropios: true, cumplimientoNormas: true, tipoInstalacion: "PLANTA" } });
    creadas.push(A.id);
    const B = await prisma.organization.create({ data: { name: `${sello} Otra empresa`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" } });
    creadas.push(B.id);
    const persona = (rol: string, nombre: string, org = A.id) => prisma.user.create({ data: { organizationId: org, email: `${nombre.toLowerCase().replace(/\s/g, "")}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x" } });
    const u = {
      OWNER: await persona("OWNER", "Dueño Prueba"), ADMIN: await persona("ADMIN", "Admin Prueba"), SUPERVISOR: await persona("SUPERVISOR", "Sup Prueba"),
      TECHNICIAN: await persona("TECHNICIAN", "Técnico Prueba"), COMPRAS: await persona("COMPRAS", "Compras Prueba"),
      REQUESTER: await persona("REQUESTER", "Solicitante Prueba"), VIEWER: await persona("VIEWER", "Consulta Prueba"),
      AJENO: await persona("OWNER", "Dueño Ajeno", B.id),
    };
    type Quien = keyof typeof u;
    const ROLES7 = ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER", "VIEWER"] as const satisfies readonly Quien[];
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "PN", name: "Planta Norte" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM", name: "Almacén general", esGeneral: true } });
    const activos: Array<{ id: string }> = [];
    for (let i = 1; i <= 12; i++) {
      activos.push(await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: `BOM-${String(i).padStart(3, "0")}`, name: `Bomba centrífuga de alimentación de agua ${i}`, serialNumber: `SN-${1000 + i}`, manufacturer: "Grundfos", model: "CR 32-2 A-F-A-E-HQQE", criticality: i % 3 === 0 ? "A" : "B" } }));
    }
    const medidor = await prisma.meter.create({ data: { organizationId: A.id, assetId: activos[0].id, name: "Horómetro", unit: "h", currentValue: 1520, lastReadingAt: new Date(Date.now() - 3 * DIA) } });
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
    // La OT del recorrido completo del técnico: preventiva, asignada, con equipo que tiene medidor.
    const otFlujo = await prisma.workOrder.create({
      data: {
        organizationId: A.id, number: "OT-100001", title: "Lubricar rodamientos y revisar vibración de la bomba 1",
        maintenanceType: "PREVENTIVE", priority: "HIGH", status: "ASSIGNED", assetId: activos[0].id, siteId: sitio.id, assignedToId: u.TECHNICIAN.id,
        dueDate: new Date(Date.now() + DIA), estimatedHours: 2, safetyNotes: "Bloqueo y etiquetado; guantes y lentes de seguridad",
        tasks: { create: [{ title: "Bloquear y etiquetar", position: 0 }, { title: "Lubricar rodamientos", position: 1 }, { title: "Revisar vibración al arrancar", position: 2 }] },
      },
    });
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
    // Bloque 7: una empresa demostrativa propia de la prueba (otro slug y otro dominio).
    const { crearEmpresaDemostrativa } = await import("../lib/demo-comercial");
    const demo = await crearEmpresaDemostrativa({ contrasena: "prueba-demo-123", slug: `demo-${sello}`, dominio: `${sello}.rs.mx` });
    demoId = demo.id;
    const du = Object.fromEntries((await prisma.user.findMany({ where: { organizationId: demo.id } })).map((x) => [x.email.split("@")[0], x]));

    // ── Archivos de prueba: una foto grande de lado (EXIF orientación 6), una imagen y un PDF
    //    de galería, un ejecutable y un video de 201 MB (vacío: el navegador solo mira el tamaño).
    const fotoGrande = join(ARCHIVOS, "placa-de-lado.jpg");
    await sharp(randomBytes(3000 * 2000 * 3), { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toFile(fotoGrande);
    const imagenGaleria = join(ARCHIVOS, "fuga-sello.png");
    await sharp({ create: { width: 400, height: 300, channels: 3, background: "#3a7f9c" } }).png().toFile(imagenGaleria);
    const pdfGaleria = join(ARCHIVOS, "hoja-de-servicio.pdf");
    writeFileSync(pdfGaleria, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const ejecutable = join(ARCHIVOS, "programa.exe");
    writeFileSync(ejecutable, "MZ no es una foto");
    const enorme = join(ARCHIVOS, "video-enorme.mp4");
    const fd = openSync(enorme, "w"); ftruncateSync(fd, 201 * 1_048_576); closeSync(fd);

    // ── La cámara simulada de Chrome muestra un QR de MainTrack (el del punto del activo).
    const textoQr = `${base}/reportar/${punto.token}`;
    const qr = QRCode.create(textoQr, { errorCorrectionLevel: "M" });
    const W = 640, H = 480, n = qr.modules.size, px = Math.floor(420 / (n + 8));
    const x0 = Math.floor((W - px * n) / 2), y0 = Math.floor((H - px * n) / 2);
    const luz = Buffer.alloc(W * H, 235);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < px; dy++) luz.fill(16, (y0 + r * px + dy) * W + x0 + c * px, (y0 + r * px + dy) * W + x0 + (c + 1) * px);
    }
    const color = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
    const cuadro = Buffer.concat([Buffer.from("FRAME\n"), luz, color]);
    const y4m = join(ARCHIVOS, "camara.y4m");
    writeFileSync(y4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(cuadro)]));

    // Lo que haya quedado de corridas anteriores, fuera: son procesos sueltos
    // que nadie va a cerrar y que envenenan la siguiente.
    try { execSync("pkill -f 'user-data-dir=.*mt-chrome-' || true", { stdio: "ignore" }); } catch { /* no habia ninguno */ }

    chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`, "about:blank"], { stdio: "ignore" });

    // ── Chrome y servidor.
    const finEspera = Date.now() + 120_000;
    let wsNavegador = "";
    while (!wsNavegador && Date.now() < finEspera) {
      try { wsNavegador = ((await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl; } catch { await esperar(500); }
    }
    for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/login`); if (r.status < 500) break; } catch { /* aún no */ } await esperar(1000); }
    const nav = await Pestana.abrir(wsNavegador);

    const errores: Array<{ donde: string; que: string }> = [];
    const fallidas: Array<{ donde: string; url: string; status: number }> = [];
    let donde = "";
    let permitidos4xx = new Set<number>();
    /** Consola y peticiones de una pestaña: todo error cuenta, salvo los que la prueba provoca a propósito. */
    const vigilar = (p: Pestana) => p.al((e) => {
      if (e.method === "Runtime.exceptionThrown") errores.push({ donde, que: JSON.stringify(e.params).slice(0, 200) });
      if (e.method === "Runtime.consoleAPICalled" && (e.params as { type: string }).type === "error") errores.push({ donde, que: JSON.stringify((e.params as { args: unknown[] }).args).slice(0, 200) });
      if (e.method === "Log.entryAdded" && (e.params as { entry: { level: string } }).entry.level === "error") {
        const entrada = (e.params as { entry: { text: string; url?: string } }).entry;
        const esperado = /net::ERR_INTERNET_DISCONNECTED|Failed to load resource: the server responded with a status of 40[39]/.test(entrada.text)
          || (permitidos4xx.size > 0 && /status of 4\d\d/.test(entrada.text)) || /net::ERR_FAILED/.test(entrada.text) && donde.startsWith("fotos");
        if (!esperado) errores.push({ donde, que: `${entrada.text} ${entrada.url ?? ""}`.slice(0, 200) });
      }
      if (e.method === "Network.responseReceived") {
        const r = (e.params as { response: { status: number; url: string } }).response;
        if (r.status >= 500 || (r.status >= 400 && !permitidos4xx.has(r.status))) fallidas.push({ donde, url: r.url.replace(base, ""), status: r.status });
      }
    });
    /** Una pestaña nueva; con `contexto`, en otra sesión del navegador (otras cookies, otro almacenamiento). */
    const abrirPestana = async (contexto?: string) => {
      const { targetId } = await nav.enviar<{ targetId: string }>("Target.createTarget", { url: "about:blank", ...(contexto ? { browserContextId: contexto } : {}) });
      const lista = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()) as Array<{ id: string; webSocketDebuggerUrl: string }>;
      const p = await Pestana.abrir(lista.find((x) => x.id === targetId)!.webSocketDebuggerUrl);
      await p.enviar("Page.enable"); await p.enviar("Runtime.enable"); await p.enviar("Network.enable"); await p.enviar("Log.enable");
      vigilar(p);
      return Object.assign(p, { targetId });
    };
    const t = await abrirPestana();

    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    /** Sesión de cualquier usuario (la demo tiene los suyos). */
    const sesionDe = async (x: { id: string; organizationId: string; email: string; name: string; role: string }, p: Pestana = t) => {
      await p.enviar("Network.clearBrowserCookies");
      const jwt = await new SignJWT({ userId: x.id, organizationId: x.organizationId, email: x.email, name: x.name, role: x.role }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);
      await p.enviar("Network.setCookie", { name: "mt_session", value: jwt, url: base, httpOnly: true });
    };
    const sesion = async (rol: Quien | null, p: Pestana = t) => {
      await p.enviar("Network.clearBrowserCookies");
      if (!rol) return;
      const x = u[rol];
      const jwt = await new SignJWT({ userId: x.id, organizationId: x.organizationId, email: x.email, name: x.name, role: x.role }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);
      await p.enviar("Network.setCookie", { name: "mt_session", value: jwt, url: base, httpOnly: true });
    };
    const pantalla = async (ancho: number, alto: number, p: Pestana = t) => {
      await p.enviar("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 2, mobile: ancho < 768 });
      await p.enviar("Emulation.setTouchEmulationEnabled", { enabled: ancho < 1024 });
    };
    const captura = async (nombre: string, p: Pestana = t) => {
      const { data } = await p.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(data, "base64"));
    };
    type Medida = { desborde: boolean; anchoDoc: number; ancho: number; fuera: string[]; chicos: string[]; nChicos: number; sinPermiso: boolean; barra: boolean; titulo: string; errorPagina: boolean; comentario: string };
    const medir = (p: Pestana = t) => p.evaluar<Medida>(MEDIDA);
    // Manejo de la página como lo haría una persona: tocar por el texto visible, teclear de verdad.
    const tocar = (p: Pestana, texto: string, dentro = "main, body") => p.evaluar<boolean>(`(() => {
      const raiz = document.querySelector(${JSON.stringify(dentro)}) || document.body;
      const e = [...raiz.querySelectorAll("button, a, summary")].find((x) => x.textContent.trim().replace(/\\s+/g, " ").includes(${JSON.stringify(texto)}) && x.getBoundingClientRect().width > 0 && !x.disabled);
      if (!e) return false; e.scrollIntoView({ block: "center" }); e.click(); return true;
    })()`);
    const teclear = async (p: Pestana, selector: string, texto: string) => {
      const ok = await p.evaluar<boolean>(`(() => { const c = document.querySelector(${JSON.stringify(selector)}); if (!c) return false; c.scrollIntoView({ block: "center" }); c.focus(); try { c.select(); } catch {} return true; })()`);
      if (ok) await p.enviar("Input.insertText", { text: texto });
      return ok;
    };
    const escoger = (p: Pestana, selector: string, textoOpcion: string) => p.evaluar<string>(`(() => {
      const s = document.querySelector(${JSON.stringify(selector)}); if (!s) return "";
      const o = [...s.options].find((x) => x.textContent.includes(${JSON.stringify(textoOpcion)})); if (!o) return "";
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value); s.dispatchEvent(new Event("change", { bubbles: true })); return o.value;
    })()`);
    /**
     * Elige en un SelectorBuscable como lo haria una persona: lo abre, escribe
     * para buscar y toca la opcion. Devuelve cuantas quedaron tras filtrar, asi
     * que tambien comprueba que la busqueda sirve.
     */
    const buscarYElegir = (p: Pestana, dentroDe: string, texto: string) => p.evaluar<{ opciones: number; elegida: string }>(`(async () => {
      const caja = document.querySelector(${JSON.stringify(dentroDe)});
      const abrir = caja.querySelector('button[aria-haspopup="listbox"]');
      abrir.click();
      await new Promise((r) => setTimeout(r, 300));
      const buscador = caja.querySelector('input[type="search"], input:not([type="hidden"])');
      const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      poner.call(buscador, ${JSON.stringify(texto)});
      buscador.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const opciones = [...caja.querySelectorAll('[role="option"]')].filter((o) => o.textContent.trim() && !/Elija|Sin seleccionar/.test(o.textContent));
      const elegida = opciones[0]?.textContent?.trim() ?? "";
      opciones[0]?.click();
      await new Promise((r) => setTimeout(r, 300));
      return { opciones: opciones.length, elegida };
    })()`);

    const hasta = async (p: Pestana, expresion: string, ms = 10_000) => {
      for (let i = 0; i < ms / 200; i++) { if (await p.evaluar<boolean>(expresion).catch(() => false)) return true; await esperar(200); }
      return false;
    };
    const textoDe = (p: Pestana) => p.evaluar<string>("document.body.innerText");
    /** Pone archivos en un <input type=file> como si la persona los eligiera (cámara o galería). */
    const elegirArchivos = async (p: Pestana, selector: string, rutas: string[]) => {
      const { result } = await p.enviar<{ result: { objectId: string } }>("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)})` });
      await p.enviar("DOM.setFileInputFiles", { objectId: result.objectId, files: rutas });
    };

    // ═══════════════════════════════════════════ 1-14: roles × tamaños
    console.log("\n1-14. Cada rol en cada tamaño");
    const PANTALLAS: Record<(typeof ROLES7)[number], string[]> = {
      OWNER: ["/dashboard", "/work-orders", `/work-orders/${ots[0].id}`, "/assets", "/compras", "/settings", "/indicadores"],
      ADMIN: ["/dashboard", "/settings?s=usuarios", "/inventory", "/puesta-en-marcha", "/plans", "/notificaciones"],
      SUPERVISOR: ["/dashboard", "/work-orders", `/work-orders/${ots[0].id}`, "/calendar", "/requests", "/board", "/backlog", "/compras", "/meters"],
      TECHNICIAN: ["/dashboard", "/work-orders?mias=1", `/work-orders/${otTec.id}`, "/escanear", `/assets/${activos[0].id}`, "/search?q=bomba", "/notificaciones", "/meters", "/inventory", "/requisiciones"],
      COMPRAS: ["/dashboard", "/compras", `/compras/${compra.id}`, "/compras/planificador", "/requisiciones", "/inventory", "/suppliers"],
      REQUESTER: ["/dashboard", "/requests", `/requests/${solicitudes[0].id}`, "/escanear", `/reportar/${punto.token}`],
      VIEWER: ["/dashboard", "/search?q=bom", "/assets", "/reports", "/work-orders", "/meters"],
    };
    // Las pantallas principales, con evidencia (captura) en cada tamaño. Las ve el Propietario.
    const PRINCIPALES: Array<[string, string]> = [
      ["inicio", "/dashboard"], ["busqueda", "/search?q=bomba"], ["avisos", "/notificaciones"], ["ordenes", "/work-orders"],
      ["orden", `/work-orders/${otTec.id}`], ["solicitudes", "/requests"], ["solicitud-nueva", "/requests?nueva=1"], ["activos", "/assets"],
      ["medidores", "/meters"], ["almacen", "/inventory"], ["requisiciones", "/requisiciones"], ["compras", "/compras"], ["configuracion", "/settings"],
    ];
    const ANCHOS: Array<[number, number, string]> = [[320, 568, "320x568"], [360, 800, "360x800"], [390, 844, "390x844"], [430, 932, "430x932"], [768, 1024, "768x1024"], [1024, 768, "1024x768"], [1440, 900, "escritorio"]];
    const problemas: Record<string, Array<Record<string, unknown>>> = {};
    const porAncho: Record<string, number> = {};
    const menus: Record<string, Array<Record<string, unknown>>> = {};
    for (const [ancho, alto, etiqueta] of process.env.SIN_TAMANOS ? [] : ANCHOS) {
      await pantalla(ancho, alto);
      problemas[etiqueta] = [];
      menus[etiqueta] = [];
      porAncho[etiqueta] = 0;
      const anotar = (rol: string, ruta: string, m: Medida) => {
        porAncho[etiqueta]++;
        // El portal del QR es público (fuera de la aplicación): no lleva la barra de navegación.
        const conBarra = !ruta.startsWith("/reportar/");
        if (m.desborde || m.fuera.length || m.sinPermiso || m.errorPagina || m.comentario || (ancho < 1024 && conBarra && !m.barra)) {
          problemas[etiqueta].push({ rol, ruta, desborde: m.desborde ? `${m.anchoDoc}>${m.ancho}` : undefined, fuera: m.fuera.length ? m.fuera : undefined, sinPermiso: m.sinPermiso || undefined, error: m.errorPagina || undefined, comentario: m.comentario || undefined, barra: ancho < 1024 ? m.barra : undefined });
        }
        if (etiqueta === "390x844" && m.nChicos) problemas["390-tactiles"] = [...(problemas["390-tactiles"] ?? []), { rol, ruta, chicos: m.chicos }];
      };
      for (const rol of ROLES7) {
        await sesion(rol);
        for (const ruta of PANTALLAS[rol]) {
          donde = `${rol} ${etiqueta} ${ruta}`;
          permitidos4xx = new Set();
          await t.ir(`${base}${ruta}`);
          anotar(rol, ruta, await medir());
        }
        // Menú del rol en este tamaño: en el teléfono y la tableta es un cajón que abre «Menú» y cierra Escape;
        // en computadora es la columna lateral. Solo lleva las pantallas del rol, y todas.
        donde = `${rol} ${etiqueta} menú`;
        await t.ir(`${base}/dashboard`);
        const esperado = menuDe(rol).flatMap((g) => g.items.map((i) => i.href));
        const visto = await t.evaluar<{ ligas: string[]; cerrado: boolean; ruta: string; abierto: boolean; hayBarra: boolean; hayBoton: boolean; titulo: string }>(`(async () => {
          // Se ESPERA a que el elemento aparezca, no se cuentan milisegundos.
          //
          // Antes habia un setTimeout de 350 ms fijos tras abrir el cajon, y en
          // escritorio se leia el aside justo al llegar. Con la maquina cargada
          // —correr la suite completa basta— ni uno ni otro habian aparecido
          // todavia: la caja salia null, las ligas vacias, y la prueba lo
          // reportaba como «al menu de este rol le faltan TODAS sus pantallas».
          // Trece fallas y una excepcion que tumbaba el resto de la corrida,
          // por una interfaz que estaba perfecta.
          const esperar = async (fn, ms = 8000) => {
            const t0 = Date.now();
            for (;;) {
              const v = fn();
              if (v) return v;
              if (Date.now() - t0 > ms) return null;
              await new Promise((r) => setTimeout(r, 50));
            }
          };
          const movil = innerWidth < 1024;
          const barra = await esperar(() => document.querySelector('nav[aria-label="Accesos principales"]'));
          const boton = barra ? [...barra.querySelectorAll("button")].find((b) => b.textContent.includes("Menú")) : null;
          let caja = movil ? null : await esperar(() => document.querySelector("aside"));
          if (movil) {
            boton?.click();
            caja = await esperar(() => document.querySelector('[role="dialog"][aria-label="Menú"]'));
          }
          // Abierta pero todavia sin pintar sus ligas es el mismo defecto con
          // otra cara: tambien se espera a que tenga algo dentro.
          if (caja) await esperar(() => caja.querySelectorAll("nav a").length > 0);
          const ligas = caja ? [...caja.querySelectorAll("nav a")].map((a) => a.getAttribute("href")) : [];
          return { ligas, abierto: !!caja, cerrado: true, ruta: location.pathname, hayBarra: !!barra, hayBoton: !!boton, titulo: document.title };
        })()`);
        // Diagnostico: sin esto, «faltan todas las pantallas» se ve igual si el
        // menu perdio sus ligas que si la sesion no entro y esto es el login.
        if (!visto.abierto || !visto.ligas.length) {
          console.log(`  info  menú vacío · rol=${rol} tam=${etiqueta} ruta=${visto.ruta} titulo="${visto.titulo}" barra=${visto.hayBarra} boton=${visto.hayBoton} aside=${visto.abierto}`);
        }
        if (ancho < 1024) {
          if (rol === "OWNER" || rol === "TECHNICIAN") await captura(`${etiqueta}-${rol.toLowerCase()}-menu-abierto`);
          await t.evaluar(`(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await new Promise((r) => setTimeout(r, 300)); })()`);
          visto.cerrado = await t.evaluar<boolean>(`!document.querySelector('[role="dialog"][aria-label="Menú"]') && location.pathname === "/dashboard"`);
          if (rol === "OWNER" || rol === "TECHNICIAN") await captura(`${etiqueta}-${rol.toLowerCase()}-menu-cerrado`);
        }
        const faltan = esperado.filter((h) => !visto.ligas.includes(h));
        const deMas = visto.ligas.filter((h) => !puedeVerRuta(rol, h));
        if (!visto.abierto || !visto.cerrado || faltan.length || deMas.length) menus[etiqueta].push({ rol, faltan, deMas, abierto: visto.abierto, cerrado: visto.cerrado });
      }
      // Evidencia de las pantallas principales en este tamaño.
      await sesion("OWNER");
      for (const [nombre, ruta] of PRINCIPALES) {
        donde = `OWNER ${etiqueta} ${ruta} (evidencia)`;
        permitidos4xx = new Set();
        await t.ir(`${base}${ruta}`, nombre === "solicitud-nueva" ? 1200 : 700);
        anotar("OWNER", ruta, await medir());
        await captura(`${etiqueta}-${nombre}`);
      }
      revisar(`${8 + ANCHOS.findIndex((a) => a[2] === etiqueta)}. ${etiqueta}: ${porAncho[etiqueta]} pantallas de los 7 roles sin desplazamiento lateral, sin controles fuera, sin «Sin permiso» en las propias`,
        problemas[etiqueta].length === 0, problemas[etiqueta].slice(0, 4));
      revisar(`    ${etiqueta}: el menú de cada rol ${ancho < 1024 ? "abre, lleva solo sus pantallas y cierra sin salir" : "lateral lleva solo sus pantallas"}`, menus[etiqueta].length === 0, menus[etiqueta].slice(0, 3));
    }
    const tactiles = problemas["390-tactiles"] ?? [];
    console.log(`  info  controles táctiles menores de 32 px en 390 px: ${tactiles.reduce((s, x) => s + (x.chicos as string[]).length, 0)} distintos en ${tactiles.length} pantallas`, JSON.stringify(tactiles.slice(0, 6)).slice(0, 600));

    // ═══════════════════════════════════════════ URL directa sin permiso, en el navegador
    console.log("\nURL directa sin permiso");
    await pantalla(390, 844);
    // La administración ve todo menos Facturación, que no tiene pantalla propia: no hay URL que probarle.
    const PROHIBIDAS = ["/compras", "/inventory", "/settings", "/work-orders", "/puesta-en-marcha", "/import"];
    const rechazos: Record<string, string> = {};
    for (const rol of ROLES7) {
      const ruta = PROHIBIDAS.find((r) => !puedeVerRuta(rol, r));
      if (!ruta) continue;
      await sesion(rol);
      donde = `${rol} prohibida ${ruta}`;
      permitidos4xx = new Set([403]);
      await t.ir(`${base}${ruta}`);
      const m = await medir();
      rechazos[rol] = `${ruta}: ${m.sinPermiso ? "rechazada" : "SE ABRIÓ"}`;
    }
    permitidos4xx = new Set();
    revisar("Cada rol que escribe en la dirección una pantalla ajena ve «Esta pantalla no es de su rol»", Object.values(rechazos).every((x) => x.endsWith("rechazada")), rechazos);
    await sesion("TECHNICIAN");
    await t.ir(`${base}/compras`);
    await captura("390-tecnico-url-sin-permiso");

    // ═══════════════════════════════════════════ Capturas de referencia
    await pantalla(390, 844);
    await sesion("TECHNICIAN");
    await t.ir(`${base}/dashboard`); await captura("390-tecnico-inicio");
    await t.ir(`${base}/work-orders/${otTec.id}`); await captura("390-tecnico-orden");
    await sesion("REQUESTER"); await t.ir(`${base}/dashboard`); await captura("390-solicitante-inicio");
    await sesion("COMPRAS"); await t.ir(`${base}/dashboard`); await captura("390-compras-inicio");
    await pantalla(1440, 900);
    await sesion("OWNER"); await t.ir(`${base}/dashboard`, 1500); await captura("1440-dueno-inicio");
    await t.ir(`${base}/indicadores`, 2500); await captura("1440-dueno-indicadores");
    await sesion("SUPERVISOR"); await t.ir(`${base}/dashboard`); await captura("1440-supervisor-inicio");

    // ═══════════════════════════════════════════ 16: menú en el teléfono
    console.log("\n16. Menú en el teléfono");
    await pantalla(390, 844);
    await sesion("REQUESTER");
    donde = "menu";
    await t.ir(`${base}/requests`);
    const menu = await t.evaluar<{ abierto: boolean; ligas: string[]; cerrado: boolean; conserva: boolean }>(`(async () => {
      const esperar = async (fn, ms = 8000) => {
        const t0 = Date.now();
        for (;;) {
          const v = fn();
          if (v) return v;
          if (Date.now() - t0 > ms) return null;
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      const campo = document.querySelector("main input, main textarea");
      // Se espera la barra en vez de darla por hecha: si no esta todavia, antes
      // reventaba aqui con «Cannot read properties of null» y se llevaba por
      // delante todos los pasos que faltaban.
      const barra = await esperar(() => document.querySelector('nav[aria-label="Accesos principales"]'));
      if (!barra) return { abierto: false, ligas: [], cerrado: false, conserva: false, sinBarra: true, ruta: location.pathname };
      [...barra.querySelectorAll("button")].find((b) => b.textContent.includes("Menú"))?.click();
      const cajon = await esperar(() => document.querySelector('[role="dialog"][aria-label="Menú"]'));
      if (cajon) await esperar(() => cajon.querySelectorAll("a").length > 0);
      const ligas = cajon ? [...cajon.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      const cerrado = await esperar(() => !document.querySelector('[role="dialog"][aria-label="Menú"]'), 3000);
      return { abierto: !!cajon, ligas, cerrado: cerrado === true, conserva: location.pathname === "/requests" };
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

    // ═══════════════════════════════════════════ 51: ordenar tocando el encabezado
    console.log("\n51. Ordenar tocando el encabezado");
    await pantalla(1440, 900);
    await sesion("SUPERVISOR");
    donde = "orden por encabezado";
    await t.ir(`${base}/work-orders`);
    /*
     * Se toca de verdad y se lee la columna, en vez de comprobar el estado por
     * dentro: lo que importa es que la LISTA cambie. El ciclo de tres estados
     * y el comparador se prueban aparte, en prueba-orden-tabla.
     */
    const orden = await t.evaluar<{
      hayBoton: boolean; etiqueta: string;
      inicial: string[]; asc: string[]; desc: string[]; vuelta: string[];
      marcaAsc: string | null; marcaDesc: string | null; marcaFuera: string | null;
    }>(`(async () => {
      const ths = [...document.querySelectorAll("table.data thead th")];
      const i = ths.findIndex((x) => x.querySelector("button"));
      const th = ths[i];
      if (!th) return { hayBoton: false, etiqueta: "", inicial: [], asc: [], desc: [], vuelta: [], marcaAsc: null, marcaDesc: null, marcaFuera: null };
      const columna = () => [...document.querySelectorAll("table.data tbody tr")]
        .map((tr) => tr.children[i]?.textContent?.trim() ?? "")
        .filter(Boolean).slice(0, 12);
      const toque = async () => { th.querySelector("button").click(); await new Promise((r) => setTimeout(r, 400)); };
      const inicial = columna();
      await toque(); const asc = columna(); const marcaAsc = th.getAttribute("aria-sort");
      await toque(); const desc = columna(); const marcaDesc = th.getAttribute("aria-sort");
      await toque(); const vuelta = columna(); const marcaFuera = th.getAttribute("aria-sort");
      return { hayBoton: true, etiqueta: th.textContent.trim(), inicial, asc, desc, vuelta, marcaAsc, marcaDesc, marcaFuera };
    })()`);
    const ordenado = [...orden.asc].sort((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
    revisar("51. un toque en el encabezado ordena la lista de verdad",
      orden.hayBoton && orden.asc.length > 1 && JSON.stringify(orden.asc) === JSON.stringify(ordenado),
      { columna: orden.etiqueta, asc: orden.asc.slice(0, 5) });
    const alReves = [...orden.desc].sort((a, b) => -a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
    revisar("    el segundo toque la invierte",
      orden.desc.length > 1
      && JSON.stringify(orden.desc) === JSON.stringify(alReves)
      && orden.desc[0] !== orden.asc[0],
      { desc: orden.desc.slice(0, 5), empiezaAsc: orden.asc[0], empiezaDesc: orden.desc[0] });
    revisar("    y el tercero la deja como llegó",
      JSON.stringify(orden.vuelta) === JSON.stringify(orden.inicial), { inicial: orden.inicial.slice(0, 5), vuelta: orden.vuelta.slice(0, 5) });
    revisar("    y lo dice en aria-sort, para quien no ve la flecha",
      orden.marcaAsc === "ascending" && orden.marcaDesc === "descending" && orden.marcaFuera === "none",
      { asc: orden.marcaAsc, desc: orden.marcaDesc, fuera: orden.marcaFuera });
    await captura("1440-supervisor-ordenes-ordenadas");

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

    // ═══════════════════════════════════════════ QR con la cámara, dentro de MainTrack
    console.log("\nEscanear QR con la cámara integrada (cámara simulada con un QR de MainTrack)");
    await pantalla(390, 844);
    await sesion("TECHNICIAN");
    // Se cuenta cada petición de cámara y con qué pide; y se guardan los flujos para ver que se apaguen.
    const { identifier: espia } = await t.enviar<{ identifier: string }>("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      window.__camara = { llamadas: 0, pedido: null, flujos: [] };
      const original = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      if (!original) return;
      navigator.mediaDevices.getUserMedia = async (c) => {
        window.__camara.llamadas++; window.__camara.pedido = JSON.stringify(c);
        if (window.__negarCamara) throw new DOMException("negado", "NotAllowedError");
        const f = await original(c); window.__camara.flujos.push(f); return f;
      };
    })()` });
    donde = "qr";
    await t.ir(`${base}/escanear`, 1000);
    const alCargar = await t.evaluar<{ llamadas: number; boton: boolean; manual: boolean; nativo: boolean }>(`({ llamadas: window.__camara.llamadas, boton: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Abrir cámara y escanear")), manual: !!document.querySelector("#codigo-equipo"), nativo: typeof window.BarcodeDetector === "function" })`);
    await captura("390-escanear");
    revisar("QR: la pantalla no pide la cámara al cargar; ofrece «Abrir cámara y escanear» y la captura manual", alCargar.llamadas === 0 && alCargar.boton && alCargar.manual, alCargar);
    // Ruta del lector: el del navegador si existe; si no, jsQR. Se prueba jsQR quitando el del navegador
    // (así lee un iPhone), y el nativo cuando el Chrome de la prueba lo trae.
    /**
     * Se intenta dos veces, y no es por tapar un defecto.
     *
     * La camara es un archivo de video que Chrome reproduce en bucle, y el
     * lector tiene que atrapar un cuadro con el codigo. Si la maquina esta
     * ocupada, el video arranca tarde y la ventana se pierde: la misma prueba
     * paso y fallo el mismo dia sin que cambiara una linea. Si el producto no
     * lee el codigo, fallan las dos.
     */
    const leerCon = async (quitarNativo: boolean, intento = 1): Promise<{ pidio: { llamadas: number; pedido: string }; llego: boolean; ruta: string; apagada: boolean; porQue?: unknown }> => {
      await t.ir(`${base}/escanear`, 1000);
      if (quitarNativo) await t.evaluar(`delete window.BarcodeDetector; window.BarcodeDetector = undefined; true`);
      await tocar(t, "Abrir cámara y escanear");
      const pidio = await t.evaluar<{ llamadas: number; pedido: string }>(`({ llamadas: window.__camara.llamadas, pedido: window.__camara.pedido })`);
      const llego = await hasta(t, `location.pathname === "/assets/${activos[0].id}"`, 25_000);
      if (!llego && intento === 1) return leerCon(quitarNativo, 2);
      /**
       * Si no leyo, hay que saber POR QUE sin tener que estar aqui mirando.
       *
       * La primera version solo decia «llego: false», y con eso no se puede
       * distinguir entre «la camara falsa no dio un cuadro bueno», «lo leyo
       * pero la ruta lo rechazo» y «el video ni arranco». Cada una se arregla
       * en un lugar distinto.
       */
      const porQue = !llego ? await t.evaluar<{ error: string; estado: string; video: { listo: number; ancho: number } }>(`(() => {
        const v = document.querySelector("video");
        const texto = document.body.innerText;
        const i = texto.indexOf("No se pudo") >= 0 ? texto.indexOf("No se pudo") : texto.indexOf("No hay conexión");
        return {
          error: i >= 0 ? texto.slice(i, i + 120).replace(/\\s+/g, " ") : "",
          estado: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).join(" | ").slice(0, 80),
          video: { listo: v ? v.readyState : -1, ancho: v ? v.videoWidth : 0 },
        };
      })()`) : null;
      const apagada = await t.evaluar<boolean>(`true`); // la página ya cambió: el flujo se detuvo al leer (se revisa abajo al cancelar)
      return { pidio, llego, ruta: await t.evaluar<string>("location.pathname"), apagada, ...(porQue ? { porQue } : {}) };
    };
    const conJsqr = await leerCon(true);
    revisar("QR: al tocar el botón se pide la cámara UNA vez, la trasera (facingMode environment), se lee el código con jsQR y abre el activo del punto",
      conJsqr.pidio.llamadas === 1 && /environment/.test(conJsqr.pidio.pedido) && conJsqr.llego, conJsqr);
    if (alCargar.nativo) {
      const conNativo = await leerCon(false);
      revisar("QR: con el lector del navegador (BarcodeDetector) también abre el activo", conNativo.llego, conNativo);
    } else console.log("  info  este Chrome no trae BarcodeDetector: solo se probó la lectura con jsQR (la de iPhone)");
    // Cancelar: un lector que no encuentra nada, y la persona se arrepiente.
    await t.ir(`${base}/escanear`, 1000);
    await t.evaluar(`window.BarcodeDetector = class { constructor() {} async detect() { return []; } }; true`);
    await tocar(t, "Abrir cámara y escanear");
    const leyendo = await hasta(t, `!!document.querySelector('video[aria-label="Vista de la cámara"]') && document.querySelector('video').readyState >= 2`, 8000);
    await captura("390-escanear-camara");
    await tocar(t, "Cancelar");
    await esperar(300);
    const cancelado = await t.evaluar<{ video: boolean; apagada: boolean; boton: boolean }>(`({ video: !!document.querySelector("video"), apagada: window.__camara.flujos.every((f) => f.getTracks().every((x) => x.readyState === "ended")), boton: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Abrir cámara y escanear")) })`);
    revisar("QR: «Cancelar» cierra la vista, apaga la cámara y regresa al botón", leyendo && !cancelado.video && cancelado.apagada && cancelado.boton, { leyendo, ...cancelado });
    // Permiso negado: se explica y se ofrece escribir el código.
    await t.evaluar(`window.__negarCamara = true; true`);
    await tocar(t, "Abrir cámara y escanear");
    await esperar(400);
    const negado = await t.evaluar<string>(`document.querySelector('[role="alert"]')?.textContent ?? ""`);
    await captura("390-escanear-sin-permiso");
    revisar("QR: si la persona niega la cámara, se dice qué pasó y cómo seguir (ajustes o escribir el código)", /permiso/i.test(negado) && /escribir el código/i.test(negado), negado);
    // Captura manual: clave del equipo, folio de OT, y un código que no es de MainTrack.
    const manual = async (valor: string) => {
      await t.ir(`${base}/escanear`, 800);
      await teclear(t, "#codigo-equipo", valor);
      await t.evaluar(`document.querySelector("#codigo-equipo").form.requestSubmit(); true`);
      await esperar(1500);
      return t.evaluar<{ ruta: string; alerta: string }>(`({ ruta: location.pathname, alerta: document.querySelector('[role="alert"]')?.textContent ?? "" })`);
    };
    const porClave = await manual("bom-002");
    const porFolio = await manual(otTec.number.toLowerCase());
    const ajeno = await manual("https://ejemplo.com/equipo/123");
    await captura("390-escanear-codigo-ajeno");
    revisar("QR: la captura manual abre el activo por su clave (sin importar mayúsculas) y la OT por su folio",
      porClave.ruta === `/assets/${activos[1].id}` && porFolio.ruta === `/work-orders/${otTec.id}`, { porClave, porFolio });
    revisar("QR: un código que no es de MainTrack no abre nada y lo explica", ajeno.ruta === "/escanear" && /no es de MainTrack/.test(ajeno.alerta), ajeno);
    await t.enviar("Page.removeScriptToEvaluateOnNewDocument", { identifier: espia });

    // ═══════════════════════════════════════════ Flujo completo del técnico en el teléfono, con el supervisor mirando
    console.log("\nFlujo del técnico en 390 × 844, con el supervisor en otra sesión");
    const { browserContextId: otraSesion } = await nav.enviar<{ browserContextId: string }>("Target.createBrowserContext");
    const sup = await abrirPestana(otraSesion);
    await pantalla(1440, 900, sup);
    await sesion("SUPERVISOR", sup);
    const urlFlujo = `${base}/work-orders/${otFlujo.id}`;
    /** El supervisor recarga la orden y dice si ve lo que se busca. */
    const supervisorVe = async (buscado: RegExp) => { await sup.ir(urlFlujo, 500); return buscado.test(await textoDe(sup)); };
    const pasos: Record<string, boolean> = {};
    await pantalla(390, 844);
    await sesion("TECHNICIAN");
    donde = "flujo abrir";
    await t.ir(urlFlujo, 1000);
    await captura("390-flujo-1-abrir");
    const estructura = await t.evaluar<{
      ficha: string; orden: string[]; plegados: number; abiertos: number; barra: string[];
      bitacoraAbierta: boolean; lecturasAbiertas: boolean;
    }>(`(() => {
      const r = document.createRange(); r.setStartBefore(document.querySelector("main")); r.setEndBefore(document.querySelector("#actividades"));
      const ids = ["actividades", "seguridad", "tiempo", "materiales", "lecturas", "evidencias", "bitacora", "resultado-movil"];
      const orden = ids.map((id) => [id, document.getElementById(id)]).filter(([, e]) => e && e.getBoundingClientRect().height > 0).sort((a, b) => a[1].getBoundingClientRect().top - b[1].getBoundingClientRect().top).map(([id]) => id);
      const detalles = [...document.querySelectorAll("main details")].filter((d) => d.getBoundingClientRect().height > 0);
      // Lo SECUNDARIO es lo que no vive dentro de una seccion del trabajo:
      // «Mas de la orden» y «Datos completos». Las secciones se pliegan segun
      // el estado (lib/secciones-orden.ts) y algunas nacen abiertas a proposito.
      const secundarios = detalles.filter((d) => !d.closest("section[id]"));
      const barra = [...document.querySelectorAll("div.fixed button, div.fixed a")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim());
      return {
        ficha: r.toString(), orden, barra,
        plegados: secundarios.filter((d) => !d.open).length,
        abiertos: secundarios.filter((d) => d.open).length,
        bitacoraAbierta: Boolean(document.querySelector("#bitacora details")?.open),
        lecturasAbiertas: Boolean(document.querySelector("#lecturas details")?.open),
      };
    })()`);
    pasos["ficha: trabajo, activo y ubicación, estado, prioridad y vencimiento antes de las actividades"] =
      ["Lubricar rodamientos y revisar", "BOM-001", "Planta Norte", "Asignada", "Alta"].every((x) => estructura.ficha.includes(x)) && /Para\s*\d{1,2} \w{3} \d{4}/.test(estructura.ficha);
    pasos["secciones en orden: verificación, riesgos, tiempo, materiales, lecturas, evidencias, bitácora, resultado"] =
      estructura.orden.join(",") === "actividades,seguridad,tiempo,materiales,lecturas,evidencias,bitacora,resultado-movil";
    pasos["lo secundario plegado en el teléfono"] = estructura.plegados >= 1 && estructura.abiertos === 0;
    // Donde el tecnico ESCRIBE no se pliega mientras la orden vive: recogerlas
    // tumbo pedir apoyo, la nota sin enviar y la captura del horometro.
    pasos["y lo que se captura —bitácora y lecturas— queda a la mano, sin abrirlo"] =
      estructura.bitacoraAbierta && estructura.lecturasAbiertas;
    pasos["barra fija: Aceptar, Iniciar, … Pedir apoyo"] = estructura.barra[0]?.includes("Aceptar") && estructura.barra.some((b) => b.includes("Iniciar")) && estructura.barra.at(-1)!.includes("Pedir apoyo");
    // Aceptar.
    donde = "flujo aceptar";
    await tocar(t, "Aceptar", "div.fixed");
    await hasta(t, `!document.querySelector("div.fixed")?.textContent.includes("Aceptar")`);
    pasos["Aceptar: queda registrado y el supervisor lo ve"] = (await prisma.auditLog.count({ where: { organizationId: A.id, entityId: otFlujo.id, action: "ACCEPTED" } })) === 1 && await supervisorVe(/Aceptó la orden/);
    // Iniciar, con doble toque: una sola transición.
    donde = "flujo iniciar";
    await t.evaluar(`(() => { const b = [...document.querySelectorAll("div.fixed button")].find((x) => x.textContent.includes("Iniciar")); b.click(); b.click(); return true; })()`);
    await hasta(t, `[...document.querySelectorAll("div.fixed button")].some((x) => x.textContent.includes("Pausar o reportar bloqueo"))`);
    const inicios = await prisma.auditLog.count({ where: { organizationId: A.id, entityId: otFlujo.id, action: "STATUS_CHANGED" } });
    pasos["Iniciar (dos toques seguidos): en proceso una sola vez; el supervisor ve «En proceso»"] =
      (await prisma.workOrder.findUnique({ where: { id: otFlujo.id } }))!.status === "IN_PROGRESS" && inicios === 1 && await supervisorVe(/En proceso/);
    await captura("390-flujo-2-en-proceso");
    // Lista de verificación.
    donde = "flujo actividades";
    for (let i = 0; i < 3; i++) {
      await t.evaluar(`(() => { const b = document.querySelector('#actividades button[aria-label="Marcar completada"]'); b?.scrollIntoView({ block: "center" }); b?.click(); return !!b; })()`);
      await esperar(900);
    }
    pasos["lista de verificación: las tres actividades completas"] = (await prisma.workOrderTask.count({ where: { workOrderId: otFlujo.id, done: true } })) === 3;
    // Tiempo, con doble toque en «Registrar horas».
    donde = "flujo tiempo";
    await teclear(t, 'input[aria-label="Horas trabajadas"]', "1.5");
    await teclear(t, 'input[aria-label="Actividad realizada"]', "Lubricación y prueba de vibración");
    permitidos4xx = new Set([409]); // el segundo toque, si llega, se rechaza con 409
    await t.evaluar(`(() => { const b = document.querySelector('button[aria-label="Registrar horas"]'); b.click(); b.click(); return true; })()`);
    await esperar(1500);
    permitidos4xx = new Set();
    const horas = await prisma.workOrderLabor.findMany({ where: { workOrderId: otFlujo.id } });
    pasos["tiempo: 1.5 h registradas una sola vez (doble toque) y el supervisor las ve"] = horas.length === 1 && Number(horas[0].hours) === 1.5 && await supervisorVe(/Lubricación y prueba de vibración/);
    // Materiales.
    donde = "flujo material";
    // Se busca la refaccion, no se recorre una lista: el almacen de una planta
    // tiene cientos y el tecnico esta buscando UNA.
    const refaccion = await buscarYElegir(t, "#materiales", "Rodamiento");
    pasos["materiales: se busca la refacción por nombre y la lista se reduce"] =
      refaccion.opciones > 0 && /Rodamiento/i.test(refaccion.elegida);
    await teclear(t, 'input[aria-label="Cantidad"]', "1");
    await tocar(t, "Cargar a la OT", "#materiales");
    await esperar(1500);
    const material = await prisma.workOrderPart.findMany({ where: { workOrderId: otFlujo.id } });
    pasos["materiales: un rodamiento cargado, existencia de 3 a 2, y el supervisor lo ve"] = material.length === 1 && Number(material[0].quantity) === 1
      && (await prisma.part.findUnique({ where: { id: parte.id } }))!.quantityOnHand === 2 && await supervisorVe(/Rodamiento de bolas 6205-2RS/);
    // Lecturas.
    donde = "flujo lectura";
    await teclear(t, 'input[aria-label="Lectura del medidor, en h"]', "1530");
    await t.evaluar(`document.querySelector('input[aria-label="Lectura del medidor, en h"]').form.requestSubmit(); true`);
    await esperar(1500);
    pasos["lecturas: el horómetro queda en 1530 y el supervisor lo ve"] = (await prisma.meter.findUnique({ where: { id: medidor.id } }))!.currentValue === 1530 && await supervisorVe(/1[,.]?530/);
    await captura("390-flujo-3-captura");
    // Evidencias: una foto con la cámara trasera y dos archivos de la galería, con vista previa antes de subir.
    donde = "flujo evidencias";
    const camaraTrasera = await t.evaluar<boolean>(`document.querySelector('#evidencias input[type=file][capture="environment"]')?.accept === "image/*"`);
    await elegirArchivos(t, '#evidencias input[type=file][capture]', [fotoGrande]);
    await elegirArchivos(t, '#evidencias input[type=file][multiple]', [imagenGaleria, pdfGaleria]);
    await esperar(500);
    const previa = await t.evaluar<{ imagenes: number; tarjetas: number; boton: string }>(`(() => ({
      imagenes: document.querySelectorAll("#evidencias li img").length, tarjetas: document.querySelectorAll("#evidencias li").length,
      boton: [...document.querySelectorAll("#evidencias button")].map((b) => b.textContent.trim()).find((x) => /Adjuntar|Subir/.test(x)) ?? "" })
    )()`);
    await captura("390-flujo-4-evidencias-previa");
    await tocar(t, previa.boton || "Adjuntar", "#evidencias");
    await hasta(t, `![...document.querySelectorAll("#evidencias button")].some((b) => /Subiendo/.test(b.textContent))`, 30_000);
    await esperar(1500);
    const adjuntos = await prisma.attachment.findMany({ where: { workOrderId: otFlujo.id } });
    console.log("  info  evidencias", JSON.stringify({ camaraTrasera, previa, subidos: adjuntos.map((a) => a.name) }));
    pasos["evidencias: cámara trasera, galería con varios, vista previa, y las tres suben; el supervisor las ve"] = camaraTrasera && previa.imagenes >= 2 && previa.tarjetas === 3
      && adjuntos.length === 3 && (await sup.ir(urlFlujo, 500), await sup.evaluar<boolean>(`["placa-de-lado", "fuga-sello.png", "hoja-de-servicio.pdf"].every((n) => document.querySelector("#evidencias")?.innerHTML.includes(n))`));
    // Pedir apoyo desde la barra: lleva a la bitácora con la casilla marcada.
    donde = "flujo apoyo";
    await tocar(t, "Pedir apoyo", "div.fixed");
    await esperar(600);
    const apoyo = await t.evaluar<{ marcada: boolean; foco: boolean }>(`(() => { const f = document.querySelector("#pedir-apoyo"); return { marcada: f.querySelector('input[type=checkbox]').checked, foco: document.activeElement === f.querySelector("textarea") }; })()`);
    await teclear(t, "#pedir-apoyo textarea", "Necesito otra persona para alinear el motor");
    await t.evaluar(`document.querySelector('#pedir-apoyo').requestSubmit(); true`);
    await esperar(1500);
    pasos["pedir apoyo: marca la casilla, enfoca la nota, avisa al supervisor y él lo ve en la bitácora"] = apoyo.marcada && apoyo.foco
      && (await prisma.notification.count({ where: { organizationId: A.id, userId: u.SUPERVISOR.id, tipo: "OT_APOYO_SOLICITADO" } })) >= 1 && await supervisorVe(/alinear el motor/);
    // Pausar o reportar bloqueo, y reanudar.
    donde = "flujo pausa";
    await tocar(t, "Pausar o reportar bloqueo", "div.fixed");
    await esperar(400);
    await teclear(t, 'textarea[aria-label="Motivo"]', "Falta el extractor de rodamientos");
    await captura("390-flujo-5-pausa");
    await t.evaluar(`(() => { const d = document.querySelector('[role="dialog"]'); const b = [...d.querySelectorAll("button")].filter((x) => x.textContent.includes("Pausar o reportar bloqueo")).at(-1); b.click(); return true; })()`);
    await hasta(t, `[...document.querySelectorAll("div.fixed button")].some((x) => x.textContent.includes("Reanudar"))`);
    pasos["pausar con motivo: queda «En espera» con el motivo y el supervisor lo ve"] = (await prisma.workOrder.findUnique({ where: { id: otFlujo.id } }))!.status === "ON_HOLD" && await supervisorVe(/En espera/) && /extractor de rodamientos/.test(await textoDe(sup));
    await tocar(t, "Reanudar", "div.fixed");
    await hasta(t, `[...document.querySelectorAll("div.fixed button")].some((x) => x.textContent.includes("Terminar y enviar a revisión"))`);
    // Resultado visible en el teléfono antes de terminar.
    const resultado = await t.evaluar<string>(`document.querySelector("#resultado-movil")?.innerText ?? ""`);
    pasos["resultado en el teléfono: dice qué se pedirá al terminar"] = resultado.length > 20;
    // Terminar y enviar a revisión.
    donde = "flujo terminar";
    await tocar(t, "Terminar y enviar a revisión", "div.fixed");
    await hasta(t, `!!document.querySelector('[role="dialog"]')`);
    await teclear(t, 'textarea[aria-label="Solución aplicada o resumen del trabajo"]', "Se lubricaron rodamientos; vibración dentro de rango.");
    await t.evaluar(`(() => { const c = [...document.querySelectorAll('[role="dialog"] input[type=checkbox]')]; for (const x of c) if (!x.checked) x.click(); return c.length; })()`);
    await captura("390-flujo-6-terminar");
    await tocar(t, "Completar orden", '[role="dialog"]');
    await hasta(t, `!document.querySelector('[role="dialog"]')`, 8000);
    await esperar(800);
    await captura("390-flujo-7-terminada");
    const final = await prisma.workOrder.findUnique({ where: { id: otFlujo.id } });
    const supTexto = (await supervisorVe(/Completada/)) ? await textoDe(sup) : "";
    pasos["terminar: queda «Completada» (en revisión) y el supervisor ve «Validar y cerrar»"] = final!.status === "COMPLETED" && /Validar y cerrar/.test(supTexto);
    await captura("1440-supervisor-ve-la-orden-terminada", sup);
    for (const [k, v] of Object.entries(pasos)) revisar(`Técnico: ${k}`, v);
    if (!Object.values(pasos).every(Boolean)) console.log("  info  estructura", JSON.stringify(estructura).slice(0, 600));

    // ═══════════════════════════════════════════ Fotos y archivos: lo que puede salir mal
    console.log("\nFotos y archivos");
    donde = "fotos";
    const guardada = adjuntos.find((a) => a.name.startsWith("placa-de-lado"));
    let medidas: { width?: number; height?: number; orientation?: number } = {};
    if (guardada) medidas = await sharp(readFileSync(join(process.cwd(), ".almacen", guardada.storagePath))).metadata();
    revisar("La foto de 3000 × 2000 tomada de lado (EXIF 6) se guarda derecha y reducida: 1333 × 2000, JPEG, más ligera",
      !!guardada && medidas.width === 1333 && medidas.height === 2000 && (medidas.orientation ?? 1) === 1 && guardada.size < statSync(fotoGrande).size && guardada.mimeType === "image/jpeg",
      { nombre: guardada?.name, ...medidas, bytes: guardada?.size, original: statSync(fotoGrande).size });
    // Otra orden en proceso del técnico para lo que falla.
    const otFotos = ots[1];
    await t.ir(`${base}/work-orders/${otFotos.id}`, 1000);
    await elegirArchivos(t, '#evidencias input[type=file][multiple]', [ejecutable, enorme]);
    await esperar(400);
    const rechazo = await t.evaluar<{ aviso: string; tarjetas: number }>(`({ aviso: document.querySelector('#evidencias [role="status"]')?.textContent ?? "", tarjetas: document.querySelectorAll("#evidencias li").length })`);
    await captura("390-fotos-rechazo");
    revisar("Un ejecutable y un video de 201 MB no se agregan, y se dice por qué (tipo y tamaño)", rechazo.tarjetas === 0 && /programa\.exe/.test(rechazo.aviso) && /201 MB|máximo/.test(rechazo.aviso), rechazo);
    await elegirArchivos(t, '#evidencias input[type=file][multiple]', [imagenGaleria]);
    await esperar(300);
    await elegirArchivos(t, '#evidencias input[type=file][multiple]', [imagenGaleria]);
    await esperar(300);
    const repetida = await t.evaluar<{ aviso: string; tarjetas: number }>(`({ aviso: document.querySelector('#evidencias [role="status"]')?.textContent ?? "", tarjetas: document.querySelectorAll("#evidencias li").length })`);
    revisar("La misma imagen elegida dos veces se agrega una sola vez y se avisa", repetida.tarjetas === 1 && /ya estaba agregado/.test(repetida.aviso), repetida);
    // Falla de red al subir: el archivo queda con su error y «Reintentar»; al reintentar, sube.
    await t.enviar("Fetch.enable", { patterns: [{ urlPattern: "*/api/attachments/local/*", requestStage: "Request" }] });
    let cortar = true;
    t.al((e) => {
      if (e.method !== "Fetch.requestPaused") return;
      const id = (e.params as { requestId: string }).requestId;
      if (cortar) void t.enviar("Fetch.failRequest", { requestId: id, errorReason: "InternetDisconnected" });
      else void t.enviar("Fetch.continueRequest", { requestId: id });
    });
    await tocar(t, "Adjuntar", "#evidencias");
    await hasta(t, `[...document.querySelectorAll("#evidencias button")].some((b) => /Reintentar/.test(b.textContent))`, 15_000);
    const conError = await t.evaluar<{ error: string; boton: string }>(`({ error: document.querySelector("#evidencias li")?.innerText ?? "", boton: [...document.querySelectorAll("#evidencias button")].map((b) => b.textContent.trim()).find((x) => /Reintentar/.test(x)) ?? "" })`);
    await captura("390-fotos-error-y-reintento");
    const antes = await prisma.attachment.count({ where: { workOrderId: otFotos.id } });
    cortar = false;
    // Con red lenta, para ver el progreso.
    await t.enviar("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: -1, uploadThroughput: 20 * 1024 });
    await tocar(t, "Reintentar", "#evidencias");
    const progreso = await hasta(t, `/\\d+%/.test(document.querySelector("#evidencias li")?.innerText ?? "")`, 8000);
    await captura("390-fotos-progreso");
    await hasta(t, `!document.querySelectorAll("#evidencias li img[src^='blob:']").length`, 30_000);
    await t.enviar("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await t.enviar("Fetch.disable");
    await esperar(800);
    const despues = await prisma.attachment.count({ where: { workOrderId: otFotos.id } });
    revisar("Sin red al subir: el archivo dice que no se guardó y ofrece «Reintentar»; con red lenta se ve el progreso; al reintentar sube una vez",
      /conexión|no se/i.test(conError.error) && /Reintentar/.test(conError.boton) && progreso && antes === 0 && despues === 1, { conError, progreso, antes, despues });
    // Ya subida, volver a elegirla se avisa como repetida.
    await t.ir(`${base}/work-orders/${otFotos.id}`, 1000);
    await elegirArchivos(t, '#evidencias input[type=file][multiple]', [imagenGaleria]);
    await esperar(300);
    const yaSubida = await t.evaluar<string>(`document.querySelector('#evidencias [role="status"]')?.textContent ?? ""`);
    revisar("Una imagen que ya está en la orden no se vuelve a agregar", /ya estaba agregado/.test(yaSubida), yaSubida);
    // Consulta posterior y aislamiento.
    const unAdjunto = adjuntos[0];
    // Se abre la liga de la evidencia: a quien puede verla se le redirige a la liga firmada; a otra empresa, 404.
    const abrirDesde = async (p: Pestana) => p.evaluar<{ status: number; tipo: string }>(`fetch("/api/attachments/${unAdjunto.id}", { redirect: "manual" }).then((r) => ({ status: r.status, tipo: r.type }))`);
    await sup.ir(urlFlujo, 500);
    const consulta = await abrirDesde(sup);
    const otraEmpresa = await abrirPestana(otraSesion);
    await sesion("AJENO", otraEmpresa);
    donde = "aislamiento";
    permitidos4xx = new Set([403, 404]);
    await otraEmpresa.ir(`${base}/dashboard`, 500);
    const deOtra = await abrirDesde(otraEmpresa);
    await otraEmpresa.ir(urlFlujo, 500);
    const ordenAjena = await textoDe(otraEmpresa);
    permitidos4xx = new Set();
    revisar("Consulta posterior: el supervisor abre la evidencia; otra empresa no puede ni abrir el archivo ni ver la orden",
      consulta.tipo === "opaqueredirect" && [403, 404].includes(deOtra.status) && !ordenAjena.includes("Lubricar rodamientos"), { consulta, deOtra });
    otraEmpresa.cerrar();

    // ═══════════════════════════════════════════ Conservar lo escrito
    console.log("\nConservación del trabajo sin guardar");
    await pantalla(390, 844);
    await sesion("TECHNICIAN");
    const otNota = ots[2];
    const urlNota = `${base}/work-orders/${otNota.id}`;
    donde = "conservar";
    await t.ir(urlNota, 1000);
    const NOTA = "Se escucha golpeteo en el cople, revisar al volver";
    await teclear(t, `#nota-${otNota.id}`, NOTA);
    await esperar(300);
    const campoNota = () => t.evaluar<{ valor: string; aviso: boolean }>(`({ valor: document.querySelector("#nota-${otNota.id}")?.value ?? "", aviso: document.body.innerText.includes("Sin guardar todavía") })`);
    const conservado: Record<string, unknown> = { escrito: await campoNota() };
    // Abrir y cerrar el menú.
    await t.evaluar(`(async () => { [...document.querySelectorAll('nav[aria-label="Accesos principales"] button')].find((b) => b.textContent.includes("Menú")).click(); await new Promise((r) => setTimeout(r, 300)); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await new Promise((r) => setTimeout(r, 300)); })()`);
    conservado.menu = await campoNota();
    // Ir al activo de la orden y regresar con «atrás».
    await t.evaluar(`(() => { const a = [...document.querySelectorAll("main a[href^='/assets/']")].find((x) => x.getBoundingClientRect().width > 0); a.click(); return a.getAttribute("href"); })()`);
    await hasta(t, `location.pathname.startsWith("/assets/")`);
    await esperar(600);
    await t.enviar("Page.navigateToHistoryEntry", { entryId: (await t.enviar<{ entries: Array<{ id: number }> }>("Page.getNavigationHistory")).entries.at(-2)!.id });
    await hasta(t, `location.pathname === "/work-orders/${otNota.id}"`);
    await esperar(1200);
    conservado.activoYAtras = await campoNota();
    // Cambiar de pestaña y volver.
    const otra = await abrirPestana();
    await nav.enviar("Target.activateTarget", { targetId: otra.targetId });
    await otra.ir(`${base}/dashboard`, 300);
    await esperar(500);
    await nav.enviar("Target.activateTarget", { targetId: (t as Pestana & { targetId: string }).targetId });
    await nav.enviar("Target.closeTarget", { targetId: otra.targetId });
    await esperar(500);
    conservado.otraPestana = await campoNota();
    // Recargar la página.
    await t.ir(urlNota, 1200);
    conservado.recarga = await campoNota();
    // Sin conexión al guardar la nota: se dice que no se guardó y se queda.
    await t.enviar("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await t.evaluar(`document.querySelector("#pedir-apoyo").requestSubmit(); true`);
    await esperar(800);
    const sinRedNota = await t.evaluar<string>(`document.querySelector('#pedir-apoyo [role="alert"]')?.textContent ?? ""`);
    await captura("390-nota-sin-conexion");
    await t.enviar("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    conservado.sinRed = { ...(await campoNota()), alerta: sinRedNota };
    const todos = ["escrito", "menu", "activoYAtras", "otraPestana", "recarga"].every((k) => { const c = conservado[k] as { valor: string; aviso: boolean }; return c.valor === NOTA && c.aviso; });
    revisar("La nota sin enviar se conserva, con «Sin guardar todavía» a la vista: al abrir el menú, ir al activo y volver, cambiar de pestaña y recargar", todos, conservado);
    revisar("    y sin conexión al enviarla: se dice que no se guardó y el texto sigue ahí", /No se guardó/i.test(sinRedNota) && (conservado.sinRed as { valor: string }).valor === NOTA, conservado.sinRed);
    await t.evaluar(`document.querySelector("#pedir-apoyo").requestSubmit(); true`);
    await esperar(1200);
    revisar("    al volver la señal se guarda una vez y el borrador se borra", (await prisma.workOrderComment.count({ where: { workOrderId: otNota.id, body: NOTA } })) === 1
      && await t.evaluar<boolean>(`!sessionStorage.getItem("mt_borrador:bitacora:${otNota.id}")`));

    // ═══════════════════════════════════════════ Conflicto entre dos sesiones, en la pantalla
    console.log("\nConflicto al editar una orden desde dos sesiones");
    const otEditar = ots[5];
    await pantalla(390, 844);
    await sesion("SUPERVISOR");
    donde = "conflicto";
    await t.ir(`${base}/work-orders/${otEditar.id}`, 1000);
    await tocar(t, "Editar");
    await hasta(t, `!!document.querySelector('[role="dialog"][aria-label="Editar orden"]')`);
    await teclear(t, 'input[aria-label="Título"]', "Cambiar sello mecánico (versión del supervisor)");
    // Mientras tanto, la administración cambia el título desde otra sesión.
    const adm = await abrirPestana(otraSesion);
    await sesion("ADMIN", adm);
    await adm.ir(`${base}/dashboard`, 300);
    const cambioAdm = await adm.evaluar<number>(`fetch("/api/work-orders/${otEditar.id}", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Cambiar sello mecánico (versión de administración)" }) }).then((r) => r.status)`);
    adm.cerrar();
    permitidos4xx = new Set([409]);
    await tocar(t, "Guardar", '[role="dialog"]');
    await hasta(t, `!!document.querySelector('[role="dialog"] [role="alert"]')`);
    const choque = await t.evaluar<{ alerta: string; valor: string }>(`({ alerta: document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? "", valor: document.querySelector('input[aria-label="Título"]').value })`);
    await captura("390-conflicto-edicion");
    permitidos4xx = new Set();
    const tituloVigente = (await prisma.workOrder.findUnique({ where: { id: otEditar.id } }))!.title;
    revisar("Dos sesiones editan el mismo título: la segunda recibe el aviso de conflicto, no pisa lo del otro, y conserva lo que escribió",
      cambioAdm === 200 && /Título|título/.test(choque.alerta) && choque.valor.includes("versión del supervisor") && tituloVigente.includes("versión de administración"), { cambioAdm, choque, tituloVigente });
    await tocar(t, "Guardar", '[role="dialog"]');
    await esperar(1200);
    revisar("    al guardar otra vez, sabiendo lo vigente, se guarda lo suyo", (await prisma.workOrder.findUnique({ where: { id: otEditar.id } }))!.title.includes("versión del supervisor"));
    sup.cerrar();
    await nav.enviar("Target.disposeBrowserContext", { browserContextId: otraSesion });

    // La barra fija de acciones no debe tapar la orden en el teléfono más chico (el dueño tiene más botones).
    await pantalla(320, 568);
    await sesion("OWNER");
    donde = "barra 320";
    await t.ir(`${base}/work-orders/${otTec.id}`);
    const barra320 = await t.evaluar<{ alto: number; botones: number }>(`(() => { const b = document.querySelector("main div.fixed"); return { alto: b ? Math.round(b.getBoundingClientRect().height) : 999, botones: b ? b.querySelectorAll("button, a").length : 0 }; })()`);
    await captura("320x568-orden-barra-dueno");
    revisar("En 320 × 568 la barra de acciones de la orden (con todos los botones del dueño) ocupa menos de un tercio de la pantalla", barra320.botones >= 4 && barra320.alto < 568 / 3, barra320);

    // ═══════════════════════════════════════════ Bloque 7: sitio, contratación, demo, recorrido y soporte
    console.log("\nBloque 7. Sitio comercial, contratación, empresa demostrativa y soporte");
    const comercial: Record<string, unknown> = {};
    for (const [ancho, alto, etiqueta] of [[390, 844, "390"], [1440, 900, "1440"]] as Array<[number, number, string]>) {
      await pantalla(ancho, alto);
      await sesion(null);
      for (const [nombre, ruta] of [["sitio", "/"], ["contratar", "/contratar"], ["legal", "/legal/sla"]]) {
        donde = `publico ${etiqueta} ${ruta}`;
        await t.ir(`${base}${ruta}`, 900);
        const m = await medir();
        comercial[`${nombre}-${etiqueta}`] = m.desborde || m.fuera.length || m.errorPagina ? { desborde: m.desborde, fuera: m.fuera } : "ok";
        await captura(`b7-${etiqueta}-${nombre}`);
      }
    }
    revisar("El sitio, la contratación y los documentos se ven completos en teléfono y en computadora, sin desplazamiento lateral", Object.values(comercial).every((x) => x === "ok"), comercial);
    // La solicitud de demostración, llenada como persona (no se envía nada fuera: queda en la base local).
    await pantalla(390, 844);
    donde = "solicitud demo";
    await t.ir(`${base}/#demostracion`, 900);
    await teclear(t, "#d-nombre", "Ana Pruebas"); await teclear(t, "#d-empresa", `${sello} Bebidas`); await teclear(t, "#d-correo", `ana@${sello}.rs.mx`);
    await t.evaluar(`(() => { const c = document.querySelector('input[type=checkbox][required]'); c.click(); return c.checked; })()`);
    await tocar(t, "Solicitar demostración", "form");
    const recibida = await hasta(t, `document.body.innerText.includes("Solicitud recibida")`);
    await captura("b7-390-solicitud-recibida");
    revisar("Solicitar una demostración desde el teléfono: valida, confirma y queda registrada con su origen", recibida && !!(await prisma.prospecto.findFirst({ where: { correo: `ana@${sello}.rs.mx`, origen: "SITIO" } })));
    await prisma.prospecto.deleteMany({ where: { correo: { endsWith: `@${sello}.rs.mx` } } });
    await prisma.notification.deleteMany({ where: { title: { contains: sello } } });

    // La demo en el teléfono: banda, recorrido que no bloquea, se omite y no vuelve; se reinicia desde la guía.
    await sesionDe(du.mecanico);
    donde = "demo tecnico";
    await t.evaluar("localStorage.clear(); true").catch(() => undefined);
    await t.ir(`${base}/dashboard`, 1200);
    const conRecorrido = await t.evaluar<{ banda: boolean; recorrido: boolean; tapa: boolean; cubiertos: number; pasos: string }>(`(() => {
      const r = document.querySelector('aside[aria-label="Recorrido de la demostración"]');
      const rr = r?.getBoundingClientRect();
      /*
       * «No tapa» se medía por TAMAÑO, y eso no era medirlo.
       *
       * Antes bastaba con que la tarjeta no pasara del 45% del alto. Pero una
       * tarjeta chica encima de un botón lo deja igual de intocable: medido en
       * 1280 x 900 sobre el almacén, cubría CINCO controles de 49 y la
       * revisión seguía en verde. Quien enseña el producto se topa con que un
       * botón no responde, y lo que falla no es el botón.
       *
       * Ahora se cuentan los controles que quedan DEBAJO de la tarjeta.
       */
      const controles = rr ? [...document.querySelectorAll("button, a[href], input, select")].filter((el) => {
        const q = el.getBoundingClientRect();
        if (r.contains(el) || q.width === 0 || q.height === 0) return false;
        if (q.top >= innerHeight || q.bottom <= 0) return false;
        /*
         * Tapado = NINGUN punto del control responde al toque.
         *
         * Mirar solo si los rectangulos se rozan daba falsas alarmas: tres
         * pixeles de esquina no impiden pulsar nada. Y mirar solo el centro
         * las daba al reves, con los controles grandes: un renglon de 364 x
         * 101 seguia siendo perfectamente usable aunque la pastilla le cayera
         * justo en el centro.
         *
         * Asi que se prueban cinco puntos —el centro y cuatro dentro de las
         * esquinas— con elementFromPoint, que es lo que de verdad decide el
         * navegador al recibir el toque. Si alguno responde, se puede usar.
         */
        const dx = q.width / 4;
        const dy = q.height / 4;
        const puntos = [
          [q.left + q.width / 2, q.top + q.height / 2],
          [q.left + dx, q.top + dy],
          [q.right - dx, q.top + dy],
          [q.left + dx, q.bottom - dy],
          [q.right - dx, q.bottom - dy],
        ];
        return puntos.every(([x, y]) => {
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
          const encima = document.elementFromPoint(x, y);
          return !!encima && (encima === r || r.contains(encima));
        });
      }) : [];
      return {
        banda: document.body.innerText.includes("Empresa demostrativa"),
        recorrido: !!r,
        tapa: (!!rr && rr.height > innerHeight * 0.45) || controles.length > 0,
        cubiertos: controles.length,
        pasos: r?.innerText.match(/\d+ de \d+/)?.[0] ?? "",
      };
    })()`);
    await captura("b7-390-demo-tecnico-recorrido");
    const m390 = await medir();
    await t.evaluar(`document.querySelector('aside[aria-label="Recorrido de la demostración"] button[aria-label="Omitir el recorrido"]')?.click(); true`);
    await t.ir(`${base}/dashboard`, 1000);
    const trasOmitir = await t.evaluar<boolean>(`!document.querySelector('aside[aria-label="Recorrido de la demostración"]')`);
    await t.ir(`${base}/demo`, 1000);
    await tocar(t, "Reiniciar el recorrido guiado");
    const reiniciado = await hasta(t, `!!document.querySelector('aside[aria-label="Recorrido de la demostración"]')`, 4000);
    await captura("b7-390-demo-guia");
    revisar("Demo en el teléfono: banda «Empresa demostrativa», recorrido chico que no tapa la pantalla, por rol; omitido no vuelve; se reinicia desde la guía",
      conRecorrido.banda && conRecorrido.recorrido && !conRecorrido.tapa && !m390.desborde && trasOmitir && reiniciado, { ...conRecorrido, trasOmitir, reiniciado });
    // Las pantallas de las historias, con el rol de cada una, en el teléfono.
    const demoMovil: Record<string, unknown> = {};
    for (const [quien, ruta] of [["direccion", "/dashboard"], ["direccion", "/paros"], ["supervision", "/dashboard"], ["supervision", "/alerts"], ["mecanico", "/work-orders?mias=1"], ["compras", "/inventory"], ["compras", "/compras"], ["operador", "/requests"], ["gerencia", "/demo"], ["mecanico", "/soporte"]] as Array<[string, string]>) {
      await sesionDe(du[quien]);
      donde = `demo ${quien} ${ruta}`;
      await t.ir(`${base}${ruta}`, 900);
      const m = await medir();
      demoMovil[`${quien} ${ruta}`] = m.desborde || m.fuera.length || m.sinPermiso || m.errorPagina ? { desborde: m.desborde, fuera: m.fuera, sinPermiso: m.sinPermiso } : "ok";
      await captura(`b7-390-demo-${quien}-${ruta.replace(/[/?=]/g, "_")}`);
    }
    revisar("Vista móvil de la demo: las pantallas de las cinco historias y el soporte, con su rol, completas y sin desplazamiento lateral", Object.values(demoMovil).every((x) => x === "ok"), demoMovil);
    await pantalla(1440, 900);
    await sesionDe(du.direccion);
    await t.evaluar("localStorage.clear(); true").catch(() => undefined);
    await t.ir(`${base}/dashboard`, 1500); await captura("b7-1440-demo-direccion-inicio");
    await t.ir(`${base}/paros`, 1500); await captura("b7-1440-demo-donde-para");
    await t.ir(`${base}/demo`, 1000); await captura("b7-1440-demo-guia");

    // ═══════════════════════════════════════════ Presentación al cliente
    console.log("\nPresentación al cliente (diapositivas)");
    const { armarPresentacion } = await import("../lib/demo-presentacion");
    const totalSlides = armarPresentacion().length;
    const nDe = (clave: string) => armarPresentacion().findIndex((d) => d.clave === clave) + 1;
    const slides: Record<string, unknown> = {};
    for (const [ancho, alto, etiqueta] of [[1440, 900, "1440"], [390, 844, "390"]] as Array<[number, number, string]>) {
      await pantalla(ancho, alto);
      donde = `presentacion ${etiqueta}`;
      await t.ir(`${base}/demo/presentacion`, 1500);
      const portada = await t.evaluar<{ titulo: string; contador: string; cubre: boolean }>(`(() => {
        const capa = document.querySelector("[data-presentacion]");
        const r = capa?.getBoundingClientRect();
        return {
          titulo: capa?.querySelector("h1")?.textContent ?? "",
          contador: capa?.innerText.match(/\\d+\\/\\d+/)?.[0] ?? "",
          cubre: !!r && r.width >= document.documentElement.clientWidth - 1 && r.height >= document.documentElement.clientHeight - 1,
        };
      })()`);
      const m = await medir();
      await captura(`presentacion-${etiqueta}-portada`);
      // Avanzar con el teclado, como en una junta.
      await t.evaluar(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`);
      await new Promise((r) => setTimeout(r, 400));
      const tras = await t.evaluar<{ contador: string; url: string }>(`({ contador: document.querySelector("[data-presentacion]")?.innerText.match(/\\d+\\/\\d+/)?.[0] ?? "", url: location.search })`);
      // Un caso, con sus botones al sistema.
      await t.ir(`${base}/demo/presentacion?d=${nDe("caso-direccion")}`, 1200);
      const caso = await t.evaluar<{ titulo: string; ligas: number; rol: boolean }>(`(() => {
        const ligas = [...document.querySelectorAll("main a[href^='/']")].length;
        return { titulo: document.querySelector("main h1")?.textContent ?? "", ligas, rol: document.body.innerText.includes("Se muestra como") };
      })()`);
      const mCaso = await medir();
      await captura(`presentacion-${etiqueta}-caso`);
      slides[etiqueta] = {
        portadaTitulo: portada.titulo.includes("Anticipe fallas"),
        portadaContador: portada.contador === `1/${totalSlides}` ? true : portada.contador,
        cubreLaPantalla: portada.cubre,
        avanzaConFlechas: tras.contador === `2/${totalSlides}` && tras.url.includes("d=2"),
        // El rol con el que se muestra el caso solo cabe en pantalla ancha.
        casoConBotones: caso.titulo.length > 0 && caso.ligas >= 3 && (ancho < 768 || caso.rol),
        sinDesborde: !m.desborde && !mCaso.desborde && !m.errorPagina && !mCaso.errorPagina,
      };
    }
    revisar("La presentación abre a pantalla completa (sin menú), avanza con las flechas dejando la diapositiva en la dirección, y cada caso trae sus botones al sistema, en computadora y en teléfono",
      Object.values(slides).every((x) => Object.values(x as Record<string, unknown>).every((v) => v === true)), slides);

    // El camino de regreso: se sale a una pantalla real y se vuelve al punto
    // exacto. Sin esto, el botón de un caso es un viaje de ida.
    await pantalla(1440, 900);
    donde = "presentacion regreso";
    await t.ir(`${base}/demo/presentacion?d=${nDe("caso-direccion")}`, 1500);
    await t.evaluar(`document.querySelector("[data-presentacion] main a[href='/indicadores']").click(); true`);
    const enIndicadores = await hasta(t, `location.pathname === "/indicadores" && !!document.querySelector('a[href^="/demo/presentacion?d="]')`, 8000);
    await captura("presentacion-1440-volver");
    await t.evaluar(`document.querySelector('[role=note] a[href^="/demo/presentacion?d="]').click(); true`);
    const deVueltaEnLaDiapositiva = await hasta(t, `document.querySelector("[data-presentacion] h1")?.textContent === ${JSON.stringify(armarPresentacion().find((d) => d.clave === "caso-direccion")!.titulo)}`, 8000);
    // Al salir de la presentación, la banda deja de ofrecer el regreso.
    await t.evaluar(`document.querySelector('[data-presentacion] header a[href="/demo"]').click(); true`);
    const sinOferta = await hasta(t, `location.pathname === "/demo" && !sessionStorage.getItem("mt_presentacion")`, 8000);
    revisar("Desde una pantalla abierta por un caso, la banda de la demo regresa a la misma diapositiva; al salir de la presentación deja de ofrecerlo",
      enIndicadores && deVueltaEnLaDiapositiva && sinOferta, { enIndicadores, deVueltaEnLaDiapositiva, sinOferta });
    await pantalla(1440, 900);
    await t.ir(`${base}/demo/presentacion?d=${nDe("precios")}`, 1200); await captura("presentacion-1440-precios");
    await t.ir(`${base}/demo/presentacion?d=${nDe("gracias")}`, 1200); await captura("presentacion-1440-gracias");
    await t.ir(`${base}/demo`, 1200); await captura("presentacion-1440-guia");

    // ═══════════════════════════════════════════ Expedientes de refacción y de plan
    console.log("\nExpedientes de refacción y de plan");
    const expedientes: Record<string, unknown> = {};
    for (const [ancho, alto, etiqueta] of [[1440, 900, "1440"], [390, 844, "390"]] as Array<[number, number, string]>) {
      await pantalla(ancho, alto);
      await sesionDe(du.gerencia);
      for (const [nombre, lista, selector] of [
        ["refaccion", "/inventory", "a[href^='/inventory/']"],
        ["plan", "/plans", "a[href^='/plans/']"],
      ] as Array<[string, string, string]>) {
        donde = `expediente ${nombre} ${etiqueta}`;
        await t.ir(`${base}${lista}`, 1200);
        const href = await t.evaluar<string>(`(() => { const a = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((x) => x.getBoundingClientRect().width > 0 && /\\/(inventory|plans)\\/[a-z0-9]{20,}/.test(x.getAttribute("href"))); return a[0]?.getAttribute("href") ?? ""; })()`);
        if (!href) { expedientes[`${nombre}-${etiqueta}`] = "sin liga en la lista"; continue; }
        await t.ir(`${base}${href}`, 1200);
        const m = await medir();
        const contenido = await t.evaluar<{ secciones: string[]; flechas: boolean }>(`({
          secciones: [...document.querySelectorAll("main h3")].map((h) => h.textContent.trim()),
          flechas: !!document.querySelector('[role="group"][aria-label="Pasar de registro"]'),
        })`);
        const esperadas = nombre === "refaccion"
          ? ["Existencia por almacén", "Últimos movimientos", "En qué equipos se ha ido", "Compras", "Planes que la consumen", "Equivalentes"]
          : ["Equipos del plan", "Actividades", "Órdenes que ha generado", "Ficha"];
        const faltan = esperadas.filter((x) => !contenido.secciones.includes(x));
        expedientes[`${nombre}-${etiqueta}`] = m.desborde || m.fuera.length || m.errorPagina || faltan.length || !contenido.flechas
          ? { desborde: m.desborde, fuera: m.fuera, error: m.errorPagina, faltan, flechas: contenido.flechas }
          : "ok";
        await captura(`expediente-${etiqueta}-${nombre}`);
      }
    }
    revisar("El expediente de la refacción y el del plan abren desde su lista, con sus secciones y sus flechas, en computadora y en teléfono", Object.values(expedientes).every((x) => x === "ok"), expedientes);

    // ═══════════════════════════════════════════ Pasar de un registro a otro
    console.log("\nPasar de un registro al siguiente desde el detalle");
    await pantalla(1440, 900);
    await sesion("SUPERVISOR");
    donde = "paso entre registros";
    await t.ir(`${base}/work-orders`, 1200);
    const primera = await t.evaluar<{ href: string; total: number }>(`(() => {
      const a = [...document.querySelectorAll("table a[href^='/work-orders/']")].filter((x) => x.getBoundingClientRect().width > 0);
      return { href: a[0]?.getAttribute("href") ?? "", total: a.length };
    })()`);
    await t.ir(`${base}${primera.href}`, 1200);
    const conFlechas = await t.evaluar<{ grupo: boolean; texto: string; anterior: boolean; siguiente: string }>(`(() => {
      const g = document.querySelector('[role="group"][aria-label="Pasar de registro"]');
      return { grupo: !!g, texto: g?.innerText.trim() ?? "", anterior: !!g?.querySelector('a[rel="prev"]'), siguiente: g?.querySelector('a[rel="next"]')?.getAttribute("href") ?? "" };
    })()`);
    await captura("paso-1440-orden-1");
    await t.evaluar(`document.querySelector('a[rel="next"]').click(); true`);
    await hasta(t, `location.pathname === "${""}" || true`, 200);
    await esperar(1500);
    const segunda = await t.evaluar<{ ruta: string; texto: string }>(`({ ruta: location.pathname, texto: document.querySelector('[role="group"][aria-label="Pasar de registro"]')?.innerText.trim() ?? "" })`);
    // Con el teclado: la flecha izquierda regresa a la anterior.
    await t.evaluar(`document.body.focus(); true`);
    await t.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
    await t.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
    await esperar(1800);
    const deVuelta = await t.evaluar<string>("location.pathname");
    // Al llegar por una liga directa (sin pasar por la lista) no hay flechas: «siguiente» no significaría nada.
    await t.evaluar("sessionStorage.clear(); true");
    await t.ir(`${base}${primera.href}`, 1200);
    const directo = await t.evaluar<boolean>(`!document.querySelector('[role="group"][aria-label="Pasar de registro"]')`);
    revisar("Desde la lista, el detalle ofrece «anterior» y «siguiente» con su posición, y avanzan de registro (también con las flechas del teclado)",
      conFlechas.grupo && /1 de \d+/.test(conFlechas.texto) && !conFlechas.anterior && !!conFlechas.siguiente && segunda.ruta === conFlechas.siguiente && /2 de \d+/.test(segunda.texto) && deVuelta === primera.href,
      { conFlechas, segunda, deVuelta, primera });
    revisar("    y no aparecen cuando se llegó por una liga directa", directo);
    // El filtro manda: la secuencia es la que la persona tiene enfrente.
    await t.ir(`${base}/work-orders`, 1200);
    await t.evaluar(`(() => { const f = document.querySelector('input[aria-label="Filtrar la lista"]'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(f, "acoplamiento 1"); f.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await esperar(900);
    const filtrada = await t.evaluar<string>(`[...document.querySelectorAll("table a[href^='/work-orders/']")][0]?.getAttribute("href") ?? ""`);
    await t.ir(`${base}${filtrada}`, 1200);
    const conFiltro = await t.evaluar<string>(`document.querySelector('[role="group"][aria-label="Pasar de registro"]')?.innerText.trim() ?? ""`);
    await captura("paso-1440-orden-filtrada");
    revisar("    la secuencia respeta el filtro de la lista, no el catálogo completo", /de \d+/.test(conFiltro) && Number(conFiltro.match(/de (\d+)/)![1]) < primera.total, { conFiltro, sinFiltro: primera.total });
    await pantalla(390, 844);
    await t.ir(`${base}/work-orders`, 1000);
    await t.evaluar(`(() => { const a = [...document.querySelectorAll("ul a[href^='/work-orders/']")].find((x) => x.getBoundingClientRect().width > 0); a.click(); return true; })()`);
    await esperar(1500);
    const enTelefono = await medir();
    await captura("paso-390-orden");
    revisar("    en el teléfono caben junto a la liga de regreso, sin desplazamiento lateral", !enTelefono.desborde && !enTelefono.fuera.length
      && await t.evaluar<boolean>(`!!document.querySelector('[role="group"][aria-label="Pasar de registro"]')`), { desborde: enTelefono.desborde, fuera: enTelefono.fuera });

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
    // ═══════════════════════════════════════════ 52: registros propios
    console.log("\n52. Registros propios");
    {
      const { crearTabla, guardarRenglon } = await import("../lib/registros");
      const alta = await crearTabla(A.id, {
        nombre: "Bitácora de diésel",
        descripcion: "Cada carga de diésel a un equipo, con litros e importe, para ver el rendimiento por equipo.",
        campos: [
          { etiqueta: "Equipo", tipo: "ACTIVO", requerido: true },
          { etiqueta: "Fecha", tipo: "FECHA", requerido: true },
          { etiqueta: "Litros", tipo: "NUMERO", requerido: true },
          { etiqueta: "Importe", tipo: "DINERO" },
          { etiqueta: "Turno", tipo: "LISTA", opciones: ["Matutino", "Vespertino", "Nocturno"] },
        ],
      }, u.ADMIN.id);
      if (!alta.ok) {
        revisar("52. la tabla de prueba se armó", false, alta.motivos);
      } else {
        for (let i = 0; i < 4; i++) {
          await guardarRenglon(A.id, alta.dato.id, {
            equipo: activos[i].id,
            fecha: new Date(Date.now() - i * DIA).toISOString().slice(0, 10),
            litros: String(100 + i * 10),
            importe: String(2500 + i * 100),
            turno: ["Matutino", "Vespertino", "Nocturno"][i % 3],
          }, u.SUPERVISOR.id);
        }

        await sesion("SUPERVISOR");
        await pantalla(1440, 900);
        donde = "registros";
        await t.ir(`${base}/registros`);
        const lista = await medir();
        const enLista = await t.evaluar<{ tarjeta: boolean; explica: boolean; cuantos: string }>(`(() => {
          const txt = document.body.innerText;
          return { tarjeta: txt.includes("Bitácora de diésel"), explica: txt.includes("rendimiento por equipo"), cuantos: (txt.match(/(\\d+) renglones/) || [])[1] ?? "" };
        })()`);
        revisar("52. el listado muestra la tabla con su explicación y cuánto tiene capturado",
          !lista.desborde && !lista.sinPermiso && enLista.tarjeta && enLista.explica && enLista.cuantos === "4", { ...enLista, desborde: lista.desborde });
        await captura("1440-supervisor-registros");

        await t.ir(`${base}/registros/${alta.dato.clave}`);
        const tabla = await medir();
        const dentro = await t.evaluar<{ equipo: boolean; suma: boolean; captura: boolean; renglones: number }>(`(() => {
          const txt = document.body.innerText;
          return {
            // La columna que apunta al equipo tiene que mostrar el equipo de
            // verdad, no un identificador: es lo que distingue esto de un Excel.
            equipo: /BOM-001 — Bomba/.test(txt),
            suma: txt.toLowerCase().includes("litros (suma)") && /\\b460\\b/.test(txt),
            captura: [...document.querySelectorAll("button")].some((b) => /Capturar/.test(b.textContent)),
            renglones: document.querySelectorAll("table.data tbody tr").length,
          };
        })()`);
        revisar("    la tabla resuelve el equipo, suma los litros y ofrece capturar",
          !tabla.desborde && dentro.equipo && dentro.suma && dentro.captura && dentro.renglones === 4, { ...dentro, desborde: tabla.desborde });
        await captura("1440-supervisor-registro-tabla");

        // El formulario se arma solo con las columnas, y la del equipo tiene que
        // traer buscador: un desplegable con doscientos equipos no se usa.
        const form = await t.evaluar<{ campos: number; buscador: boolean; vacio: boolean }>(`(async () => {
          [...document.querySelectorAll("button")].find((b) => /Capturar/.test(b.textContent)).click();
          await new Promise((r) => setTimeout(r, 400));
          const etiquetas = [...document.querySelectorAll("label")].map((l) => l.textContent.trim());
          const combo = document.querySelector('[role="combobox"], [aria-haspopup="listbox"]');
          return {
            campos: etiquetas.filter((x) => /Equipo|Fecha|Litros|Importe|Turno/.test(x)).length,
            buscador: !!combo,
            // Ninguna columna arranca con algo elegido: una refacción
            // preseleccionada en la orden movía inventario con un solo toque.
            vacio: !document.body.innerText.includes("BOM-001 — Bomba centrífuga de alimentación de agua 1Fecha"),
          };
        })()`);
        revisar("    el formulario sale de las columnas, con buscador en la del equipo y sin nada preseleccionado",
          form.campos >= 5 && form.buscador && form.vacio, form);
        await captura("1440-supervisor-registro-captura");

        await sesion("ADMIN");
        await t.ir(`${base}/registros/nueva`);
        const armador = await medir();
        const formatos = await t.evaluar<{ cuantos: number; contratos: boolean; blanco: boolean; porQue: boolean }>(`(() => {
          const txt = document.body.innerText;
          return {
            cuantos: [...document.querySelectorAll("button")].filter((b) => /columnas$/m.test(b.textContent)).length,
            contratos: txt.includes("Gestión de contratos"),
            blanco: txt.includes("En blanco"),
            porQue: txt.includes("Garantías y vigencias"),
          };
        })()`);
        revisar("    el armador abre en los formatos ya hechos, con «en blanco» al final",
          !armador.desborde && formatos.cuantos === 7 && formatos.contratos && formatos.blanco && formatos.porQue, formatos);
        await captura("1440-admin-registros-armar");

        // En el telefono: es donde se captura una bitacora, caminando.
        await sesion("SUPERVISOR");
        await pantalla(390, 844);
        await t.ir(`${base}/registros/${alta.dato.clave}`);
        const movil = await medir();
        revisar("    en el teléfono la tabla no se desborda de lado",
          !movil.desborde && !movil.fuera.length, { desborde: movil.desborde, fuera: movil.fuera });
        await captura("390-supervisor-registro-tabla");

        // El tecnico ve la tabla pero no una restringida a administracion.
        const restringida = await crearTabla(A.id, {
          nombre: "Contratos de servicio",
          descripcion: "Los contratos con terceros y lo que se les paga al mes.",
          permiso: "settings:write", rolesVer: ["OWNER", "ADMIN"],
          campos: [{ etiqueta: "Objeto", tipo: "TEXTO", requerido: true }],
        }, u.ADMIN.id);
        if (restringida.ok) {
          await sesion("TECHNICIAN");
          await pantalla(1440, 900);
          await t.ir(`${base}/registros`);
          const delTecnico = await t.evaluar<string>(`document.body.innerText`);
          revisar("    el técnico ve la bitácora y NO la tabla restringida a administración",
            delTecnico.includes("Bitácora de diésel") && !delTecnico.includes("Contratos de servicio"),
            { bitacora: delTecnico.includes("Bitácora de diésel"), restringida: delTecnico.includes("Contratos de servicio") });
          await t.ir(`${base}/registros/${restringida.dato.clave}`);
          const cerrada = await medir();
          const textoCerrada = await t.evaluar<string>(`document.body.innerText`);
          revisar("    y si escribe la dirección a mano, lee «Sin permiso» y NO su contenido",
            textoCerrada.includes("no está disponible para su rol") && !textoCerrada.includes("Los contratos con terceros"),
            { avisa: textoCerrada.includes("no está disponible para su rol"), filtra: !textoCerrada.includes("Los contratos con terceros") });
          void cerrada;
        }
      }
    }

    // ═══════════════════════════════════════════ 53: cumplimiento normativo
    console.log("\n53. Cumplimiento normativo");
    {
      const { adoptarDelCatalogo, amarrar, normaPorClave } = await import("../lib/normas");
      const adopcion = await adoptarDelCatalogo(A.id, "NOM-002-STPS", u.ADMIN.id);
      if (!adopcion.ok) {
        revisar("53. se adoptó la norma de prueba", false, adopcion.motivos);
      } else {
        const planNormas = await prisma.maintenancePlan.create({
          data: { organizationId: A.id, name: "Revisión mensual de extintores", intervalDays: 30, active: true, nextDueDate: new Date(Date.now() + 20 * DIA) },
        });
        const n0 = (await normaPorClave(A.id, "NOM-002-STPS"))!;
        await amarrar(A.id, n0.obligaciones[0].id, "plan", planNormas.id, u.ADMIN.id);

        await sesion("ADMIN");
        await pantalla(1440, 900);
        donde = "normas";
        await t.ir(`${base}/normas`);
        const lista = await medir();
        const enLista = await t.evaluar<{ norma: boolean; noPromete: boolean; sinRespaldo: boolean }>(`(() => {
          const txt = document.body.innerText;
          return {
            norma: txt.includes("NOM-002-STPS"),
            // La frontera del producto tiene que estar A LA VISTA, no en letra
            // chica: es lo que separa ayudar de vender falsa seguridad.
            noPromete: txt.includes("No dictamina si cumple con la ley"),
            sinRespaldo: txt.toLowerCase().includes("sin respaldo"),
          };
        })()`);
        revisar("53. el listado trae la norma, el semáforo y lo que el módulo NO promete",
          !lista.desborde && enLista.norma && enLista.noPromete && enLista.sinRespaldo, { ...enLista, desborde: lista.desborde });
        await captura("1440-admin-normas");

        await t.ir(`${base}/normas/NOM-002-STPS`);
        const detalle = await medir();
        const dentro = await t.evaluar<{ obligaciones: number; plan: boolean; fuera: boolean; alCorriente: boolean }>(`(() => {
          const txt = document.body.innerText;
          return {
            obligaciones: (txt.match(/se cumple con/gi) || []).length,
            plan: txt.includes("Revisión mensual de extintores"),
            // Decir lo que la norma pide y aquí NO se lleva es parte del trato.
            fuera: txt.includes("Lo que esta norma pide y aquí no se lleva"),
            alCorriente: txt.includes("Al corriente"),
          };
        })()`);
        revisar("    el detalle muestra las obligaciones, el respaldo amarrado y lo que queda fuera de alcance",
          !detalle.desborde && dentro.obligaciones === 3 && dentro.plan && dentro.fuera && dentro.alCorriente, { ...dentro, desborde: detalle.desborde });
        await captura("1440-admin-norma-detalle");

        await t.ir(`${base}/normas/NOM-002-STPS/expediente`);
        const expediente = await medir();
        const exp = await t.evaluar<{ encabezado: boolean; periodo: boolean; sinRespaldo: boolean }>(`(() => {
          const txt = document.body.innerText;
          return {
            encabezado: txt.includes("EXPEDIENTE DE CUMPLIMIENTO"),
            periodo: /Periodo del .* al /.test(txt),
            // Lo que quedó sin respaldo se DICE: mejor que lo vea aquí que
            // enfrente del inspector.
            sinRespaldo: txt.toLowerCase().includes("sin respaldo en el sistema"),
          };
        })()`);
        revisar("    el expediente sale con su periodo y dice qué quedó sin respaldo",
          !expediente.desborde && exp.encabezado && exp.periodo && exp.sinRespaldo, { ...exp, desborde: expediente.desborde });
        await captura("1440-admin-norma-expediente");

        // El código del formato controlado en la orden impresa: le sirve a
        // cualquier cliente certificado, contrate o no el módulo.
        await prisma.organization.update({ where: { id: A.id }, data: { codigoFormatoOT: "FOR-MTTO-012", revisionFormatoOT: "3" } });
        const otConPlan = await prisma.workOrder.create({
          data: { organizationId: A.id, number: "OT-NOR-1", title: "Revisión de extintores", assetId: activos[0].id, planId: planNormas.id, status: "CLOSED", completedAt: new Date() },
        });
        await t.ir(`${base}/work-orders/${otConPlan.id}/print`);
        const impresa = await t.evaluar<{ codigo: boolean; norma: boolean }>(`(() => {
          const txt = document.body.innerText;
          return { codigo: txt.includes("FOR-MTTO-012") && txt.includes("Rev. 3"), norma: txt.includes("NOM-002-STPS") };
        })()`);
        revisar("    la orden impresa lleva el código del formato y la norma a la que responde",
          impresa.codigo && impresa.norma, impresa);
        await captura("1440-orden-impresa-formato");

        // En el teléfono: el semáforo se consulta caminando.
        await pantalla(390, 844);
        await t.ir(`${base}/normas`);
        const movil = await medir();
        revisar("    en el teléfono el semáforo no se desborda de lado",
          !movil.desborde && !movil.fuera.length, { desborde: movil.desborde, fuera: movil.fuera });
        await captura("390-admin-normas");

        // El técnico NO la ve: el índice es de quien analiza, no de quien ejecuta.
        await sesion("TECHNICIAN");
        await pantalla(1440, 900);
        await t.ir(`${base}/normas`);
        const delTecnico = await medir();
        revisar("    el técnico no entra al cumplimiento normativo", delTecnico.sinPermiso, { sinPermiso: delTecnico.sinPermiso });
      }
    }

    revisar("50. sin errores en la consola en todo el recorrido", errores.length === 0, errores.slice(0, 5));
    revisar("    y ninguna petición fallida (4xx o 5xx)", fallidas.length === 0, fallidas.slice(0, 8));
    console.log(`\n  Capturas en ${CAPTURAS}`);
    t.cerrar(); nav.cerrar();
  } finally {
    if (demoId) { const { borrarDemo } = await import("../lib/demo-comercial"); await borrarDemo(demoId).catch((e) => console.error("no se borró la demo", e)); }
    for (const id of [...creadas].reverse()) await prisma.organization.delete({ where: { id } }).catch((e) => console.error("no se borró", id, e));
    try { chrome?.kill("SIGTERM"); } catch { /* ya cerró */ }
    // El SIGTERM al padre no siempre se lleva a los procesos ayudantes, y un
    // Chrome huerfano es exactamente lo que envenena la corrida siguiente.
    try { execSync(`pkill -f 'user-data-dir=${perfil}' || true`, { stdio: "ignore" }); } catch { /* ya no estaba */ }
    rmSync(ARCHIVOS, { recursive: true, force: true });
    for (const id of creadas) rmSync(join(process.cwd(), ".almacen", `org-${id}`), { recursive: true, force: true });
    /**
     * El servidor se mata a conciencia, no de compromiso.
     *
     * `npx next start` deja un nieto llamado `next-server` que NO muere con un
     * SIGTERM al grupo: uno de esos sobrevivio horas ocupando el puerto y
     * envenenando cada corrida siguiente. Primero se pide por las buenas, y
     * lo que siga escuchando en el puerto de esta corrida se cierra a la
     * fuerza.
     */
    if (servidor?.pid) {
      try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya terminó */ }
      await esperar(1500);
      try { process.kill(-servidor.pid, "SIGKILL"); } catch { /* ya terminó */ }
    }
    if (!process.env.BASE_URL) {
      try { execSync(`lsof -ti:${PUERTO_APP} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* nada escuchando */ }
    }
  }
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
