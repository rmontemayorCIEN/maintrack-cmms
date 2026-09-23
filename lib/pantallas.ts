/**
 * Qué pantallas ve cada rol, en un solo lugar.
 *
 * `lib/rbac.ts` dice qué puede HACER cada rol (crear, cerrar, autorizar); esto
 * dice qué puede VER. De aquí salen el menú, las acciones rápidas, la guardia
 * del servidor (la pantalla responde «Sin permiso» aunque se escriba la
 * dirección a mano) y las consultas de la API que alimentan esas pantallas.
 * Un menú que se filtra aparte de la guardia termina ofreciendo ligas que
 * acaban en «Sin permiso»: por eso los dos leen la misma tabla.
 *
 * Sin dependencias de servidor: lo importa también el menú del navegador.
 */
import { can, type Permission } from "./rbac";

export type Rol = "OWNER" | "ADMIN" | "SUPERVISOR" | "TECHNICIAN" | "COMPRAS" | "REQUESTER" | "VIEWER";
export const ROLES: Rol[] = ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER", "VIEWER"];

const TODOS = ROLES;
const MANDO: Rol[] = ["OWNER", "ADMIN", "SUPERVISOR"];
const ADMINISTRACION: Rol[] = ["OWNER", "ADMIN"];
/** Quien trabaja o supervisa el mantenimiento, más quien solo consulta. */
const OPERACION: Rol[] = ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "VIEWER"];
const ALMACEN: Rol[] = ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS"];
const ANALISIS: Rol[] = ["OWNER", "ADMIN", "SUPERVISOR", "VIEWER"];

/**
 * Cada ruta con los roles que la ven. Gana el prefijo más largo:
 * `/work-orders/armar` es más estricta que `/work-orders`.
 */
const REGLAS: Array<{ ruta: string; roles: Rol[] }> = [
  { ruta: "/dashboard", roles: TODOS },
  { ruta: "/notificaciones", roles: TODOS },
  { ruta: "/search", roles: TODOS },
  { ruta: "/glossary", roles: TODOS },
  // Bloque 7: pedir ayuda a MainTrack es de todos; la guía de demostración, solo en la empresa demostrativa.
  { ruta: "/soporte", roles: TODOS },
  { ruta: "/demo", roles: TODOS },
  // Ajustes: cada quien ve lo suyo (preferencias de avisos, su contraseña); las
  // pestañas de la empresa las filtra la propia pantalla con settings:write.
  { ruta: "/settings", roles: TODOS },
  { ruta: "/escanear", roles: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER"] },

  { ruta: "/board", roles: OPERACION },
  { ruta: "/calendar", roles: OPERACION },
  // Solicitudes: el solicitante y el técnico ven las suyas; quien revisa, todas.
  { ruta: "/requests", roles: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "REQUESTER", "VIEWER"] },
  // El rondin lo camina quien pasa por la planta —supervision y tecnicos— y
  // lo consulta quien analiza. Anotar paradas exige ademas workorder:execute,
  // asi que consulta entra a mirar, no a escribir.
  { ruta: "/rondines", roles: OPERACION },
  { ruta: "/requests/puntos", roles: MANDO },
  { ruta: "/alerts", roles: OPERACION },
  { ruta: "/predictive", roles: OPERACION },

  { ruta: "/work-orders", roles: OPERACION },
  { ruta: "/work-orders/new", roles: MANDO },
  { ruta: "/work-orders/armar", roles: MANDO },
  { ruta: "/backlog", roles: OPERACION },
  { ruta: "/equipo", roles: MANDO },

  { ruta: "/assets", roles: OPERACION },
  { ruta: "/assets/levantamiento", roles: MANDO },
  { ruta: "/meters", roles: OPERACION },
  { ruta: "/plans", roles: OPERACION },
  { ruta: "/conjuntos", roles: OPERACION },

  { ruta: "/inventory", roles: ALMACEN },
  // Valor del inventario, costo de reponer, kardex valuado: dinero.
  { ruta: "/inventory/analisis", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/inventory/indicadores", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/inventory/kardex", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/requisiciones", roles: ALMACEN },
  // Compras completas (montos, cotizaciones, proveedores) no son del técnico:
  // él pide material con un vale en Requisiciones y el almacén lo escala.
  { ruta: "/compras", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/suppliers", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },

  { ruta: "/paros", roles: ANALISIS },
  { ruta: "/reports", roles: ANALISIS },
  { ruta: "/indicadores", roles: ANALISIS },
  // Preguntar a toda la base o diagnosticarla con IA es análisis de mando.
  { ruta: "/consulta", roles: MANDO },
  { ruta: "/diagnostico", roles: MANDO },

  { ruta: "/puesta-en-marcha", roles: ADMINISTRACION },
  { ruta: "/catalogs", roles: ADMINISTRACION },
  { ruta: "/import", roles: ADMINISTRACION },
  { ruta: "/billing", roles: ["OWNER"] },
];

/** Rutas que no son de un rol sino de la plataforma: solo el operador. */
const DE_PLATAFORMA = ["/clients"];

function reglaDe(ruta: string) {
  let mejor: (typeof REGLAS)[number] | null = null;
  for (const r of REGLAS) {
    if ((ruta === r.ruta || ruta.startsWith(`${r.ruta}/`)) && (!mejor || r.ruta.length > mejor.ruta.length)) mejor = r;
  }
  return mejor;
}

/**
 * ¿Este rol ve esta pantalla? Una ruta que no está en la tabla solo la ve el
 * mando: lo nuevo nace cerrado y se abre a propósito, no al revés.
 */
export function puedeVerRuta(rol: string | undefined, ruta: string, opciones: { esSuperAdmin?: boolean; esDemo?: boolean } = {}): boolean {
  if (!rol) return false;
  const limpia = ruta.split("?")[0].replace(/\/+$/, "") || "/";
  if ((limpia === "/demo" || limpia.startsWith("/demo/")) && !opciones.esDemo) return false;
  if (DE_PLATAFORMA.some((p) => limpia === p || limpia.startsWith(`${p}/`))) return Boolean(opciones.esSuperAdmin);
  const regla = reglaDe(limpia);
  return (regla?.roles ?? MANDO).includes(rol as Rol);
}

/**
 * Quién ve costos de mantenimiento: mano de obra, refacciones consumidas,
 * costo de activos, costo de paro. Técnico y solicitante no: trabajan la orden,
 * no la administran. Consulta sí: suele ser gerencia o auditoría que revisa
 * resultados. Compras ve lo de compras (montos, cotizaciones) en sus pantallas,
 * no el costo de las órdenes.
 */
export function verCostos(rol: string | undefined): boolean {
  return ["OWNER", "ADMIN", "SUPERVISOR", "VIEWER"].includes(rol ?? "");
}

/** Costo de refacciones e inventario: además de quien ve costos, Compras (es su trabajo). */
export function verCostosDeAlmacen(rol: string | undefined): boolean {
  return verCostos(rol) || rol === "COMPRAS";
}

/** Ve todas las solicitudes, o solo las que levantó. */
export function veTodasLasSolicitudes(rol: string | undefined): boolean {
  return ["OWNER", "ADMIN", "SUPERVISOR", "VIEWER"].includes(rol ?? "");
}

// ─────────────────────────────────────────── Menú

export type ItemMenu = { href: string; etiqueta: string; icono: string; porInstalacion?: boolean };
export type GrupoMenu = { seccion: string; clave: string; items: ItemMenu[] };

/**
 * El menú, ordenado por el día de quien lo usa: cómo voy, qué me llegó, qué
 * tengo que hacer, sobre qué equipos, con qué material, cómo me fue. La
 * configuración al final: se toca las primeras semanas y casi nunca después.
 */
const MENU: GrupoMenu[] = [
  {
    seccion: "Cómo voy", clave: "inicio", items: [
      { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
      { href: "/board", etiqueta: "Tablero", icono: "tablero" },
      { href: "/calendar", etiqueta: "Calendario", icono: "calendario" },
    ],
  },
  {
    seccion: "Lo que llega", clave: "entradas", items: [
      { href: "/requests", etiqueta: "Solicitudes", icono: "solicitudes" },
      { href: "/requests/puntos", etiqueta: "Puntos de reporte QR", icono: "qr" },
      // El rondin va junto a las solicitudes y los puntos QR porque es lo
      // mismo por otro camino: una fuente de hallazgos. Y comparte con los
      // puntos el codigo pegado en la pared.
      { href: "/rondines", etiqueta: "Rondines", icono: "rondin" },
      { href: "/alerts", etiqueta: "Alertas", icono: "alertas" },
    ],
  },
  {
    seccion: "El trabajo", clave: "trabajo", items: [
      { href: "/work-orders", etiqueta: "Órdenes de trabajo", icono: "ordenes" },
      { href: "/work-orders/armar", etiqueta: "Armar una orden", icono: "armar" },
      { href: "/backlog", etiqueta: "Trabajo pendiente", icono: "backlog" },
      // «Personal» y no «Equipo»: en el mismo menú, «equipos» son las máquinas.
      { href: "/equipo", etiqueta: "Personal", icono: "personal" },
    ],
  },
  {
    seccion: "Equipos y planes", clave: "activos", items: [
      { href: "/assets", etiqueta: "Activos / Equipos", icono: "activos" },
      { href: "/escanear", etiqueta: "Escanear QR", icono: "escanear" },
      { href: "/meters", etiqueta: "Medidores", icono: "medidores" },
      { href: "/plans", etiqueta: "Planes preventivos", icono: "planes" },
      { href: "/conjuntos", etiqueta: "Conjuntos", icono: "conjuntos", porInstalacion: true },
      { href: "/predictive", etiqueta: "Predictivo", icono: "predictivo" },
    ],
  },
  {
    seccion: "Almacén y compras", clave: "almacen", items: [
      { href: "/inventory", etiqueta: "Almacén", icono: "almacen" },
      { href: "/requisiciones", etiqueta: "Requisiciones", icono: "requisiciones" },
      { href: "/compras", etiqueta: "Compras", icono: "compras" },
      { href: "/suppliers", etiqueta: "Proveedores", icono: "proveedores" },
    ],
  },
  {
    seccion: "Cómo me fue", clave: "analisis", items: [
      { href: "/indicadores", etiqueta: "Indicadores", icono: "indicadores" },
      { href: "/paros", etiqueta: "Dónde para la planta", icono: "paros" },
      { href: "/reports", etiqueta: "Reportes", icono: "reportes" },
      { href: "/consulta", etiqueta: "Pregunte a sus datos", icono: "consulta" },
      { href: "/diagnostico", etiqueta: "Diagnóstico IA", icono: "diagnostico" },
    ],
  },
  {
    seccion: "Configuración", clave: "config", items: [
      { href: "/puesta-en-marcha", etiqueta: "Puesta en marcha", icono: "puesta" },
      { href: "/catalogs", etiqueta: "Catálogos", icono: "catalogos" },
      { href: "/import", etiqueta: "Importar datos", icono: "importar" },
      { href: "/settings", etiqueta: "Ajustes", icono: "ajustes" },
    ],
  },
  {
    seccion: "Ayuda", clave: "ayuda", items: [
      { href: "/soporte", etiqueta: "Soporte", icono: "soporte" },
      { href: "/glossary", etiqueta: "Glosario", icono: "glosario" },
    ],
  },
];

/** El menú de un rol: solo lo que puede abrir, sin grupos vacíos. */
export function menuDe(rol: string | undefined, opciones: { esSuperAdmin?: boolean; esDemo?: boolean } = {}): GrupoMenu[] {
  const grupos = MENU
    .map((g) => ({ ...g, items: g.items.filter((i) => puedeVerRuta(rol, i.href, opciones)) }))
    .filter((g) => g.items.length);
  if (opciones.esDemo) {
    grupos.unshift({ seccion: "Demostración", clave: "demo", items: [{ href: "/demo", etiqueta: "Guía de la demostración", icono: "demo" }] });
  }
  if (opciones.esSuperAdmin) {
    grupos.push({ seccion: "Plataforma", clave: "plataforma", items: [{ href: "/clients", etiqueta: "Empresas cliente", icono: "clientes" }] });
  }
  return grupos;
}

/**
 * La barra inferior del teléfono: cuatro destinos al alcance del pulgar, los
 * del trabajo diario de cada rol. «Menú» abre el resto.
 */
const BARRA: Record<Rol, ItemMenu[]> = {
  OWNER: [
    { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
    { href: "/work-orders", etiqueta: "Órdenes", icono: "ordenes" },
    { href: "/indicadores", etiqueta: "Indicadores", icono: "indicadores" },
    { href: "/notificaciones", etiqueta: "Avisos", icono: "avisos" },
  ],
  ADMIN: [
    { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
    { href: "/work-orders", etiqueta: "Órdenes", icono: "ordenes" },
    { href: "/assets", etiqueta: "Activos", icono: "activos" },
    { href: "/notificaciones", etiqueta: "Avisos", icono: "avisos" },
  ],
  SUPERVISOR: [
    { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
    { href: "/work-orders", etiqueta: "Órdenes", icono: "ordenes" },
    { href: "/calendar", etiqueta: "Calendario", icono: "calendario" },
    { href: "/requests", etiqueta: "Solicitudes", icono: "solicitudes" },
  ],
  TECHNICIAN: [
    { href: "/dashboard", etiqueta: "Mi día", icono: "inicio" },
    { href: "/work-orders?mias=1", etiqueta: "Mis órdenes", icono: "ordenes" },
    { href: "/escanear", etiqueta: "Escanear", icono: "escanear" },
    { href: "/notificaciones", etiqueta: "Avisos", icono: "avisos" },
  ],
  COMPRAS: [
    { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
    { href: "/compras", etiqueta: "Compras", icono: "compras" },
    { href: "/requisiciones", etiqueta: "Requisiciones", icono: "requisiciones" },
    { href: "/notificaciones", etiqueta: "Avisos", icono: "avisos" },
  ],
  REQUESTER: [
    { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
    { href: "/requests?nueva=1", etiqueta: "Reportar", icono: "nueva" },
    { href: "/requests", etiqueta: "Mis reportes", icono: "solicitudes" },
    { href: "/escanear", etiqueta: "Escanear", icono: "escanear" },
  ],
  VIEWER: [
    { href: "/dashboard", etiqueta: "Inicio", icono: "inicio" },
    { href: "/search", etiqueta: "Buscar", icono: "buscar" },
    { href: "/assets", etiqueta: "Activos", icono: "activos" },
    { href: "/reports", etiqueta: "Reportes", icono: "reportes" },
  ],
};

export function barraDe(rol: string | undefined): ItemMenu[] {
  return (BARRA[rol as Rol] ?? BARRA.VIEWER).filter((i) => puedeVerRuta(rol, i.href));
}

// ─────────────────────────────────────────── Acciones rápidas

export type AccionRapida = { href: string; etiqueta: string; icono: string; permiso?: Permission };

/**
 * Lo que cada rol hace con más frecuencia, a un toque desde su inicio. Solo
 * aparece lo que el servidor le va a aceptar: la pantalla tiene que poder
 * verla y, si la acción escribe, tener el permiso.
 */
const ACCIONES: Record<Rol, AccionRapida[]> = {
  OWNER: [
    { href: "#situacion-critica", etiqueta: "Ver situación crítica", icono: "alertas" },
    { href: "/indicadores", etiqueta: "Ver indicadores", icono: "indicadores" },
    { href: "/compras?estado=SOLICITADA", etiqueta: "Revisar autorizaciones", icono: "compras", permiso: "purchase:authorize" },
  ],
  ADMIN: [
    { href: "/settings?s=usuarios", etiqueta: "Crear usuario", icono: "personal", permiso: "user:manage" },
    { href: "/assets?nuevo=1", etiqueta: "Crear activo", icono: "activos", permiso: "asset:write" },
    { href: "/puesta-en-marcha", etiqueta: "Revisar puesta en marcha", icono: "puesta", permiso: "settings:write" },
    { href: "/import", etiqueta: "Importar datos", icono: "importar", permiso: "settings:write" },
  ],
  SUPERVISOR: [
    { href: "/work-orders/new", etiqueta: "Crear OT", icono: "nueva", permiso: "workorder:write" },
    { href: "/work-orders?sinResponsable=1", etiqueta: "Asignar trabajo", icono: "personal", permiso: "workorder:write" },
    { href: "/work-orders?estado=COMPLETED", etiqueta: "Revisar OT terminadas", icono: "revisar", permiso: "workorder:close" },
    { href: "/calendar", etiqueta: "Consultar calendario", icono: "calendario" },
  ],
  TECHNICIAN: [
    { href: "/work-orders?mias=1", etiqueta: "Ver mis órdenes", icono: "ordenes" },
    { href: "/escanear", etiqueta: "Escanear QR", icono: "escanear" },
    { href: "/meters", etiqueta: "Registrar lectura", icono: "medidores" },
    { href: "/work-orders?mias=1&estado=IN_PROGRESS", etiqueta: "Reportar bloqueo", icono: "bloqueo", permiso: "workorder:execute" },
  ],
  COMPRAS: [
    { href: "/requisiciones", etiqueta: "Ver requisiciones", icono: "requisiciones" },
    { href: "/compras?estado=AUTORIZADA", etiqueta: "Preparar compra", icono: "compras", permiso: "purchase:receive" },
    { href: "/compras?estado=EN_COMPRA", etiqueta: "Revisar entregas", icono: "proveedores" },
    { href: "/suppliers", etiqueta: "Proveedores", icono: "proveedores" },
    { href: "/inventory", etiqueta: "Almacén", icono: "almacen" },
  ],
  REQUESTER: [
    { href: "/requests?nueva=1", etiqueta: "Reportar un problema", icono: "nueva", permiso: "request:create" },
    { href: "/requests", etiqueta: "Mis reportes", icono: "solicitudes" },
    { href: "/escanear", etiqueta: "Escanear punto de reporte", icono: "escanear" },
  ],
  VIEWER: [
    { href: "/search", etiqueta: "Buscar", icono: "buscar" },
    { href: "/assets", etiqueta: "Consultar activos", icono: "activos" },
    { href: "/reports", etiqueta: "Abrir reportes", icono: "reportes" },
  ],
};

export function accionesRapidasDe(rol: string | undefined): AccionRapida[] {
  return (ACCIONES[rol as Rol] ?? []).filter((a) =>
    (a.href.startsWith("#") || puedeVerRuta(rol, a.href)) && (!a.permiso || can(rol, a.permiso)));
}

/** Cómo se llama el inicio de cada rol. */
export const TITULO_INICIO: Record<Rol, string> = {
  OWNER: "Estado de la empresa",
  ADMIN: "Operación y configuración",
  SUPERVISOR: "El trabajo de hoy",
  TECHNICIAN: "Mi día",
  COMPRAS: "Compras y entregas",
  REQUESTER: "Mis reportes",
  VIEWER: "Consulta",
};
