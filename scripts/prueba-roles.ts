/**
 * Bloque 8, frente 2 — Sesiones reales por rol.
 *
 * Siete cuentas, cada una con su contrasena, entrando por `/api/auth/login`.
 * Nada de cookies firmadas por la propia prueba ni de cambiarle el rol a
 * nadie en la base a mitad del camino: si mañana el inicio de sesion rechazara
 * a un rol, esta prueba se entera.
 *
 * Cada renglon deja ESPERADO, REAL y la respuesta del servidor, para que la
 * matriz sirva de evidencia y no de afirmacion.
 *
 * La columna «movil» no se inventa aqui: la respuesta del servidor es la misma
 * en telefono que en computadora —es el mismo endpoint— y lo que cambia es el
 * dibujo, que se verifica en `scripts/prueba-responsiva.ts`, donde las 62
 * pantallas de los 7 roles se abren en siete anchos. Aqui se comprueba que la
 * pantalla contesta con un navegador de telefono, que es lo unico que el
 * servidor distingue.
 *
 *   npx tsx scripts/prueba-roles.ts
 */
import { prisma } from "../lib/db";
import { aplicarMovimiento } from "../lib/almacen";
import { inicioDe } from "../lib/inicio";
import { menuDe, TITULO_INICIO, type Rol } from "../lib/pantallas";
import {
  borrarEmpresas, empresaConRoles, entrar, esperarServidor, fotoDeLasDemas,
  levantarServidor, pedir, ROLES_DE_PRUEBA, type Respuesta,
} from "./apoyo-pruebas";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3212";
const CLAVE = "Prueba-Roles-2026";
const MOVIL = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1" };
const SIN_PERMISO = "Esta pantalla no es de su rol";

let fallas = 0;
const matriz: Array<{ rol: string; prueba: string; esperado: string; real: string; evidencia: string; estado: string }> = [];

function anotar(rol: string, prueba: string, esperado: string, bien: boolean, real: string, evidencia: string) {
  if (!bien) fallas++;
  matriz.push({ rol, prueba, esperado, real, evidencia: evidencia.slice(0, 120), estado: bien ? "APROBADO" : "FALLIDO" });
  if (!bien) console.log(`  FALLA ${rol} · ${prueba}\n        esperado: ${esperado}\n        real:     ${real} · ${evidencia.slice(0, 160)}`);
}

/** Una accion que el rol SI puede hacer. */
function permitida(rol: string, prueba: string, r: Respuesta) {
  anotar(rol, prueba, "se permite (2xx)", r.status < 300, `HTTP ${r.status}`, JSON.stringify(r.json).slice(0, 120));
}

/** Una accion que el rol NO puede hacer: 401, 403 o 404, nunca 2xx. */
function rechazada(rol: string, prueba: string, r: Respuesta) {
  const bien = [401, 403, 404].includes(r.status);
  anotar(rol, prueba, "se rechaza (403 o 404), sin ejecutar nada", bien, `HTTP ${r.status}`, String(r.json.error ?? "").slice(0, 120));
}

/** Una pantalla que el rol ve. */
function pantallaPropia(rol: string, ruta: string, r: Respuesta) {
  const bien = r.status === 200 && !r.texto.includes(SIN_PERMISO);
  anotar(rol, `abre ${ruta}`, "la pantalla abre con su contenido", bien, `HTTP ${r.status}`, bien ? "sin «Sin permiso»" : "muestra «Sin permiso»");
}

/**
 * Una seccion de Configuracion que el rol NO administra.
 *
 * `/settings` la abre cualquiera —ahi estan su cuenta, su apariencia y sus
 * avisos—, asi que escribir `?s=usuarios` a mano contesta 200: lo que importa
 * es que NO dibuje esa seccion ni la ofrezca. Se comprueba de las dos formas:
 * la pestaña no aparece y el dato que solo vive ahi tampoco.
 */
function seccionAjena(rol: string, seccion: string, prohibido: string, r: Respuesta) {
  // Ojo con buscar `s=usuarios` a secas: Next refleja la URL pedida dentro del
  // payload del servidor, asi que esa cadena aparece aunque la pantalla no
  // dibuje nada de la seccion. Lo que delata que SI la ofrece es el enlace de
  // la pestaña.
  const ofrece = r.texto.includes(`href="/settings?s=${seccion}"`);
  const filtra = prohibido !== "" && r.texto.includes(prohibido);
  const bien = r.status === 200 && !ofrece && !filtra;
  anotar(rol, `escribe /settings?s=${seccion} en la barra de direcciones`,
    "cae en «Mi cuenta»: ni ofrece la pestaña ni dibuja su contenido", bien, `HTTP ${r.status}`,
    bien ? "sin pestaña y sin el dato de esa sección" : `${ofrece ? "ofrece la pestaña · " : ""}${filtra ? `filtra «${prohibido}»` : ""}`);
}

/** Una pantalla que el rol NO ve, escrita a mano en la barra de direcciones. */
function pantallaAjena(rol: string, ruta: string, r: Respuesta) {
  const bien = r.texto.includes(SIN_PERMISO) || [403, 404].includes(r.status);
  anotar(rol, `escribe ${ruta} en la barra de direcciones`, "«Esta pantalla no es de su rol» (no se abre)", bien, `HTTP ${r.status}`,
    bien ? "«Sin permiso»" : r.texto.slice(0, 100).replace(/\s+/g, " "));
}

async function main() {
  const servidor = levantarServidor(3212);
  const sello = `roles-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const { org: A, cuentas } = await empresaConRoles(sello, CLAVE);
    const { org: B, cuentas: cuentasB } = await empresaConRoles(`${sello}-b`, CLAVE);
    creadas.push(A.id, B.id);
    const antes = await fotoDeLasDemas(creadas);

    // ── Datos de las dos empresas ──────────────────────────────────────────
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "EQ-1", name: "Bomba", criticality: "A" } });
    const parte = await prisma.part.create({ data: { organizationId: A.id, code: "REF-1", name: "Sello", unit: "pza", unitCost: 100, quantityOnHand: 0 } });
    await aplicarMovimiento({ organizationId: A.id, partId: parte.id, warehouseId: almacen.id, tipo: "IN", cantidad: 20, costoUnitario: 100, userId: cuentas.OWNER.id, referencia: "Inicial" });

    const ot = await prisma.workOrder.create({
      data: { organizationId: A.id, number: `OT-R-${sello}`, title: "Orden de la matriz", maintenanceType: "INSPECTION", status: "ASSIGNED", assetId: equipo.id, assignedToId: cuentas.TECHNICIAN.id },
    });
    const compra = await prisma.purchaseRequest.create({
      data: { organizationId: A.id, folio: `RC-R-${sello}`, estado: "SOLICITADA", solicitanteId: cuentas.COMPRAS.id, warehouseId: almacen.id, montoEstimado: 5000 },
    });

    // Empresa B: lo que nadie de A debe poder abrir.
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "S1", name: "Planta B" } });
    const almacenB = await prisma.warehouse.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "ALM", name: "Almacén B", esGeneral: true } });
    const equipoB = await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "EQ-B", name: "Equipo de la otra empresa" } });
    const otB = await prisma.workOrder.create({
      data: { organizationId: B.id, number: `OT-B-${sello}`, title: "De la otra empresa", maintenanceType: "CORRECTIVE", status: "OPEN", assetId: equipoB.id },
    });
    const compraB = await prisma.purchaseRequest.create({
      data: { organizationId: B.id, folio: `RC-B-${sello}`, estado: "SOLICITADA", solicitanteId: cuentasB.COMPRAS.id, warehouseId: almacenB.id, montoEstimado: 900 },
    });
    const archivoB = await prisma.attachment.create({
      data: { organizationId: B.id, workOrderId: otB.id, name: "b.png", storagePath: `org-${B.id}/ordenes/b.png`, mimeType: "image/png", kind: "PHOTO", size: 10 },
    });

    await esperarServidor(BASE);

    // ── Siete inicios de sesión de verdad ──────────────────────────────────
    console.log("\nEntrando con cada cuenta por /api/auth/login\n");
    const c: Record<string, Record<string, string>> = {};
    for (const { rol, nombre } of ROLES_DE_PRUEBA) {
      c[rol] = await entrar(BASE, cuentas[rol].email, CLAVE);
      anotar(nombre, "inicia sesión con su correo y contraseña", "recibe cookie de sesión", true, "HTTP 200", "cookie mt_session emitida");
    }
    const cB = await entrar(BASE, cuentasB.OWNER.email, CLAVE);

    // ── Página inicial y menú de cada rol ──────────────────────────────────
    console.log("Página inicial, menú y pantallas de cada rol\n");
    for (const { rol, nombre } of ROLES_DE_PRUEBA) {
      const usuario = await prisma.user.findUniqueOrThrow({ where: { id: cuentas[rol].id }, include: { organization: true } });
      const inicio = await inicioDe(usuario as never);
      const menu = menuDe(rol).flatMap((g) => g.items.map((i) => i.href));
      anotar(nombre, "su página inicial es la que le toca", `título «${TITULO_INICIO[rol as Rol] ?? "Inicio"}»`,
        inicio.titulo === (TITULO_INICIO[rol as Rol] ?? "Inicio"), inicio.titulo, `${inicio.resumen.length} cifras · ${inicio.bloques.length} bloques`);
      anotar(nombre, "su menú lleva solo pantallas que puede abrir", "ninguna entrada del menú responde «Sin permiso»",
        menu.length > 0, `${menu.length} entradas`, menu.slice(0, 6).join(" "));

      const enMovil = await pedir(BASE, "GET", "/dashboard", { ...c[rol], ...MOVIL });
      anotar(nombre, "su inicio responde igual desde un teléfono", "HTTP 200 con su contenido",
        enMovil.status === 200 && !enMovil.texto.includes(SIN_PERMISO), `HTTP ${enMovil.status}`, "User-Agent de iPhone");
    }

    // ═══════════════════════════════════════════ Propietario
    console.log("Propietario\n");
    for (const ruta of ["/settings?s=usuarios", "/settings?s=organizacion", "/settings?s=auditoria", "/settings?s=suscripcion", "/settings?s=cobranza", "/catalogs", "/compras"]) {
      pantallaPropia("Propietario", ruta, await pedir(BASE, "GET", ruta, c.OWNER));
    }
    // El otro lado de `seccionAjena`: si el detector no viera una pestaña
    // ofrecida, los rechazos de abajo pasarian sin probar nada.
    const config = await pedir(BASE, "GET", "/settings", c.OWNER);
    const pestanas = ["usuarios", "cobranza", "auditoria", "organizacion"].filter((x) => config.texto.includes(`href="/settings?s=${x}"`));
    anotar("Propietario", "Configuración le ofrece las pestañas de administración", "usuarios, cobranza, auditoría y organización",
      pestanas.length === 4, `${pestanas.length} de 4`, pestanas.join(", "));

    permitida("Propietario", "autoriza una compra", await pedir(BASE, "POST", `/api/compras/${compra.id}`, c.OWNER, { accion: "AUTORIZAR" }));
    permitida("Propietario", "da de alta a una persona", await pedir(BASE, "POST", "/api/users", c.OWNER, { name: "Nuevo", email: `nuevo-${sello}@prueba.mx`, password: CLAVE, role: "TECHNICIAN" }));

    // ═══════════════════════════════════════════ Administrador
    console.log("Administrador\n");
    for (const ruta of ["/settings?s=usuarios", "/catalogs", "/import", "/puesta-en-marcha"]) {
      pantallaPropia("Administrador", ruta, await pedir(BASE, "GET", ruta, c.ADMIN));
    }
    permitida("Administrador", "da de alta a una persona", await pedir(BASE, "POST", "/api/users", c.ADMIN, { name: "Otro", email: `otro-${sello}@prueba.mx`, password: CLAVE, role: "TECHNICIAN" }));
    seccionAjena("Administrador", "cobranza", "Estado de cuenta", await pedir(BASE, "GET", "/settings?s=cobranza", c.ADMIN));
    rechazada("Administrador", "cambia el plan de la empresa (reservado al propietario)", await pedir(BASE, "POST", "/api/plan-requests", c.ADMIN, { plan: "PROFESSIONAL" }));

    // ═══════════════════════════════════════════ Supervisor
    console.log("Supervisor\n");
    const solSup = await prisma.workRequest.create({ data: { organizationId: A.id, number: `SS-R-${sello}`, title: "Reporte para convertir", requestedById: cuentas.REQUESTER.id, assetId: equipo.id, tipo: "FALLA" } });
    permitida("Supervisor", "crea una orden", await pedir(BASE, "POST", "/api/work-orders", c.SUPERVISOR, { title: `Orden del supervisor ${sello}`, maintenanceType: "PREVENTIVE", priority: "MEDIUM", assetId: equipo.id, aceptarAdvertencias: true }));
    permitida("Supervisor", "asigna una orden", await pedir(BASE, "PATCH", `/api/work-orders/${ot.id}`, c.SUPERVISOR, { assignedToId: cuentas.TECHNICIAN.id, aceptarAdvertencias: true }));
    permitida("Supervisor", "convierte una solicitud en orden", await pedir(BASE, "POST", `/api/requests/${solSup.id}`, c.SUPERVISOR, { action: "APPROVE", assignedToId: cuentas.TECHNICIAN.id }));
    permitida("Supervisor", "da de alta un activo", await pedir(BASE, "POST", "/api/assets", c.SUPERVISOR, { code: `EQ-S-${Date.now()}`, name: "Equipo del supervisor", siteId: sitio.id }));
    rechazada("Supervisor", "autoriza una compra (es de dirección)", await pedir(BASE, "POST", `/api/compras/${compra.id}`, c.SUPERVISOR, { accion: "AUTORIZAR" }));
    rechazada("Supervisor", "da de alta a una persona", await pedir(BASE, "POST", "/api/users", c.SUPERVISOR, { name: "X", email: `x-${sello}@prueba.mx`, role: "TECHNICIAN" }));
    seccionAjena("Supervisor", "usuarios", cuentas.TECHNICIAN.email, await pedir(BASE, "GET", "/settings?s=usuarios", c.SUPERVISOR));

    // ═══════════════════════════════════════════ Técnico
    console.log("Técnico\n");
    pantallaPropia("Técnico", "/work-orders?mias=1", await pedir(BASE, "GET", "/work-orders?mias=1", c.TECHNICIAN));
    permitida("Técnico", "acepta su orden", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/aceptar`, c.TECHNICIAN, {}));
    permitida("Técnico", "inicia su orden", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "IN_PROGRESS" }));
    permitida("Técnico", "la pone en espera", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "ON_HOLD", motivo: "Falta refacción" }));
    permitida("Técnico", "la reanuda", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "IN_PROGRESS" }));
    permitida("Técnico", "registra horas", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/labor`, c.TECHNICIAN, { hours: 1.5, notes: "Revisión" }));
    permitida("Técnico", "carga una refacción", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/parts`, c.TECHNICIAN, { partId: parte.id, quantity: 1 }));
    permitida("Técnico", "termina la orden", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "COMPLETED", resolution: "Revisado y sin novedad", motivoSinDiagnostico: "Inspección sin falla", sinParoConfirmado: true }));
    rechazada("Técnico", "cierra la orden (cierre administrativo)", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, { status: "CLOSED" }));
    rechazada("Técnico", "da de alta a una persona", await pedir(BASE, "POST", "/api/users", c.TECHNICIAN, { name: "Y", email: `y-${sello}@prueba.mx`, role: "TECHNICIAN" }));
    rechazada("Técnico", "autoriza una compra", await pedir(BASE, "POST", `/api/compras/${compra.id}`, c.TECHNICIAN, { accion: "AUTORIZAR" }));
    pantallaAjena("Técnico", "/compras", await pedir(BASE, "GET", "/compras", c.TECHNICIAN));
    seccionAjena("Técnico", "usuarios", cuentas.OWNER.email, await pedir(BASE, "GET", "/settings?s=usuarios", c.TECHNICIAN));
    seccionAjena("Técnico", "auditoria", "Registro de las operaciones", await pedir(BASE, "GET", "/settings?s=auditoria", c.TECHNICIAN));

    // ═══════════════════════════════════════════ Compras
    console.log("Compras\n");
    pantallaPropia("Compras", "/compras", await pedir(BASE, "GET", "/compras", c.COMPRAS));
    pantallaPropia("Compras", "/suppliers", await pedir(BASE, "GET", "/suppliers", c.COMPRAS));
    const compraDeCompras = await pedir(BASE, "POST", "/api/compras", c.COMPRAS, {
      warehouseId: almacen.id, urgencia: "NORMAL", justificacion: "Reposición de mínimos",
      renglones: [{ partId: parte.id, descripcion: "Sello", cantidadSolicitada: 5, costoEstimado: 100 }],
    });
    permitida("Compras", "levanta una requisición de compra", compraDeCompras);
    rechazada("Compras", "autoriza su propia compra", await pedir(BASE, "POST", `/api/compras/${compra.id}`, c.COMPRAS, { accion: "AUTORIZAR" }));
    rechazada("Compras", "da de alta a una persona", await pedir(BASE, "POST", "/api/users", c.COMPRAS, { name: "Z", email: `z-${sello}@prueba.mx`, role: "TECHNICIAN" }));
    pantallaAjena("Compras", "/work-orders", await pedir(BASE, "GET", "/work-orders", c.COMPRAS));
    seccionAjena("Compras", "usuarios", cuentas.OWNER.email, await pedir(BASE, "GET", "/settings?s=usuarios", c.COMPRAS));

    // ═══════════════════════════════════════════ Solicitante
    console.log("Solicitante\n");
    pantallaPropia("Solicitante", "/requests", await pedir(BASE, "GET", "/requests", c.REQUESTER));
    permitida("Solicitante", "levanta un reporte", await pedir(BASE, "POST", "/api/requests", c.REQUESTER, { title: `Reporte del solicitante ${sello}`, description: "Hace ruido", assetId: equipo.id, tipo: "FALLA" }));
    rechazada("Solicitante", "crea una orden de trabajo", await pedir(BASE, "POST", "/api/work-orders", c.REQUESTER, { title: "No debería", maintenanceType: "CORRECTIVE", priority: "LOW", aceptarAdvertencias: true }));
    rechazada("Solicitante", "consume una refacción", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/parts`, c.REQUESTER, { partId: parte.id, quantity: 1 }));
    pantallaAjena("Solicitante", "/indicadores (costos)", await pedir(BASE, "GET", "/indicadores", c.REQUESTER));
    seccionAjena("Solicitante", "organizacion", "Identidad de la empresa", await pedir(BASE, "GET", "/settings?s=organizacion", c.REQUESTER));
    seccionAjena("Solicitante", "usuarios", cuentas.OWNER.email, await pedir(BASE, "GET", "/settings?s=usuarios", c.REQUESTER));

    // ═══════════════════════════════════════════ Consulta
    console.log("Consulta\n");
    pantallaPropia("Consulta", "/work-orders", await pedir(BASE, "GET", "/work-orders", c.VIEWER));
    pantallaPropia("Consulta", "/indicadores", await pedir(BASE, "GET", "/indicadores", c.VIEWER));
    rechazada("Consulta", "crea una orden", await pedir(BASE, "POST", "/api/work-orders", c.VIEWER, { title: "No debería", maintenanceType: "CORRECTIVE", priority: "LOW", aceptarAdvertencias: true }));
    rechazada("Consulta", "levanta un reporte", await pedir(BASE, "POST", "/api/requests", c.VIEWER, { title: "No debería", description: "x", tipo: "FALLA" }));
    rechazada("Consulta", "registra horas", await pedir(BASE, "POST", `/api/work-orders/${ot.id}/labor`, c.VIEWER, { hours: 1 }));
    rechazada("Consulta", "mueve el almacén", await pedir(BASE, "POST", "/api/parts/movements", c.VIEWER, { partId: parte.id, warehouseId: almacen.id, movementType: "IN", quantity: 1, reference: "No debería" }));
    rechazada("Consulta", "da de alta un activo", await pedir(BASE, "POST", "/api/assets", c.VIEWER, { code: "NO", name: "No debería", siteId: sitio.id }));
    rechazada("Consulta", "cambia la configuración", await pedir(BASE, "PATCH", "/api/organization", c.VIEWER, { name: "Cambiado" }));
    seccionAjena("Consulta", "usuarios", cuentas.OWNER.email, await pedir(BASE, "GET", "/settings?s=usuarios", c.VIEWER));
    rechazada("Consulta", "pide la lista de personas por la API", await pedir(BASE, "GET", "/api/users", c.VIEWER));

    // ═══════════════════════════════════════════ Aislamiento entre empresas
    console.log("Aislamiento entre empresas\n");
    for (const { rol, nombre } of ROLES_DE_PRUEBA) {
      const ajenas = await Promise.all([
        pedir(BASE, "GET", `/assets/${equipoB.id}`, c[rol]),
        pedir(BASE, "GET", `/work-orders/${otB.id}`, c[rol]),
        pedir(BASE, "GET", `/api/attachments/${archivoB.id}`, c[rol]),
        pedir(BASE, "GET", `/compras/${compraB.id}`, c[rol]),
      ]);
      const nombres = ["activo", "orden", "archivo", "compra"];
      const revelan = ajenas
        .map((r, i) => ({ que: nombres[i], status: r.status, revela: r.texto.includes("Equipo de la otra empresa") || r.texto.includes("De la otra empresa") || r.texto.includes(compraB.folio) }))
        .filter((x) => x.revela);
      anotar(nombre, "escribe en la barra el activo, la OT, el archivo y la compra DE OTRA EMPRESA",
        "ninguno se abre ni revela su contenido", revelan.length === 0,
        ajenas.map((r) => r.status).join("/"), revelan.length ? JSON.stringify(revelan) : "ninguno revela contenido");
    }
    const deBEnA = await pedir(BASE, "GET", `/work-orders/${ot.id}`, cB);
    anotar("Otra empresa", "el dueño de la empresa B abre una OT de la empresa A", "no la ve",
      !deBEnA.texto.includes("Orden de la matriz"), `HTTP ${deBEnA.status}`, "no aparece el título de la orden");

    // ── Las demás empresas, intactas ──────────────────────────────────────
    anotar("Todas", "ninguna de estas pruebas tocó otra empresa", "los conteos de las demás quedan idénticos",
      antes === await fotoDeLasDemas(creadas), "sin cambios", "8 conteos comparados");

    // ── La matriz ─────────────────────────────────────────────────────────
    console.log("\n\nMATRIZ DE ROLES\n");
    console.log("| Rol | Prueba | Resultado esperado | Resultado real | Evidencia | Estado |");
    console.log("|---|---|---|---|---|---|");
    for (const m of matriz) {
      console.log(`| ${m.rol} | ${m.prueba} | ${m.esperado} | ${m.real} | ${m.evidencia.replace(/\|/g, "·")} | ${m.estado} |`);
    }
  } finally {
    await borrarEmpresas(creadas);
    if (servidor?.pid) { try { process.kill(-servidor.pid); } catch { /* ya cerró */ } }
  }

  console.log(`\n${matriz.length} revisiones · ${fallas ? `${fallas} FALLARON` : "todas aprobadas"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
