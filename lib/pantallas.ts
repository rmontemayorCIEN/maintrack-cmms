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
  { ruta: "/inventory/proyeccion", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/inventory/indicadores", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  // Herramientas: lo VE quien trabaja con el almacen —incluido el tecnico, que
  // es quien las trae— y el reporte de perdidas, que nombra personas y les
  // pone una cifra al lado, solo quien ve costos.
  { ruta: "/inventory/herramientas", roles: ALMACEN },
  { ruta: "/inventory/herramientas/perdidas", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/inventory/kardex", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/requisiciones", roles: ALMACEN },
  // Compras completas (montos, cotizaciones, proveedores) no son del técnico:
  // él pide material con un vale en Requisiciones y el almacén lo escala.
  { ruta: "/compras", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  { ruta: "/suppliers", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS"] },
  // Las vigencias las VE tambien el tecnico: saber que el equipo esta en
  // garantia antes de abrirlo es justo para el. Capturarlas es otra cosa
  // («vigencia:write»).
  { ruta: "/vigencias", roles: ["OWNER", "ADMIN", "SUPERVISOR", "COMPRAS", "TECHNICIAN"] },

  // Registros propios: las tablas que arma el cliente. La ruta la ve
  // cualquiera con sesion porque QUIEN VE CADA TABLA lo decide la tabla misma
  // (`rolesVer` en `lib/registros.ts`), no la ruta: una empresa puede tener una
  // bitacora abierta a todos y un registro contable solo para administracion.
  // Sin tablas visibles la pantalla sale vacia, que es lo correcto.
  { ruta: "/registros", roles: TODOS },
  // Armar o ajustar una tabla es definir esquema, o sea configuracion.
  { ruta: "/registros/nueva", roles: ADMINISTRACION },
  { ruta: "/registros/armar", roles: ADMINISTRACION },

  // Cumplimiento normativo: lo VE quien analiza y quien supervisa —el tecnico
  // no necesita el indice, necesita su orden— y lo CONFIGURA quien tiene
  // Ajustes: decidir a que se obliga la empresa no es operacion.
  { ruta: "/normas", roles: ANALISIS },
  { ruta: "/normas/nueva", roles: ADMINISTRACION },

  { ruta: "/paros", roles: ANALISIS },
  { ruta: "/reports", roles: ANALISIS },
  { ruta: "/indicadores", roles: ANALISIS },
  { ruta: "/presupuestos", roles: ["OWNER", "ADMIN", "SUPERVISOR", "VIEWER"] },
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

export type ItemMenu = {
  href: string;
  etiqueta: string;
  icono: string;
  porInstalacion?: boolean;
  /**
   * Solo aparece si la empresa contrato «Registros propios».
   *
   * Esto es contrato, no permiso, y por eso NO vive en `REGLAS`: un cliente
   * que no lo contrato y escribe la direccion a mano tiene que leer «esto se
   * contrata aparte» y no «Sin permiso», que es un mensaje equivocado y manda
   * a la persona a pedirle accesos a su administrador. La pantalla lo explica;
   * el menu solo deja de ofrecerlo.
   */
  requiereRegistros?: boolean;
  /** Igual que `requiereRegistros`, para «Cumplimiento normativo». */
  requiereNormas?: boolean;
};
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
      { href: "/requests", etiqueta: "Solicitudes de servicio", icono: "solicitudes" },
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
      { href: "/work-orders/cierre", etiqueta: "Qué falta para cerrar", icono: "ordenes" },
      { href: "/backlog", etiqueta: "Trabajo pendiente", icono: "backlog" },
      // «Personal» y no «Equipo»: en el mismo menú, «equipos» son las máquinas.
      { href: "/equipo", etiqueta: "Personal", icono: "personal" },
    ],
  },
  {
    /*
     * Un cajon propio, y no dentro de «El trabajo».
     *
     * Ahi estaba mal por dos razones: ese grupo es el ciclo de la orden
     * —abrirla, armarla, cerrarla, lo pendiente— y un registro propio no
     * participa en el; y lo que se lleva aqui es transversal, asi que no cabe
     * en ningun grupo existente: la bitacora del diesel es de equipos, la
     * entrega de proteccion es de personal y los contratos son de
     * administracion.
     *
     * El grupo entero desaparece si la empresa no contrato el modulo, porque
     * `menuDe` quita los grupos que se quedan sin items.
     */
    seccion: "Sus registros", clave: "registros", items: [
      { href: "/registros", etiqueta: "Registros propios", icono: "registros", requiereRegistros: true },
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
      { href: "/inventory/herramientas", etiqueta: "Herramientas", icono: "herramientas" },
      { href: "/requisiciones", etiqueta: "Requisiciones", icono: "requisiciones" },
      { href: "/compras", etiqueta: "Compras", icono: "compras" },
      { href: "/compras/planificador", etiqueta: "Qué hay que comprar", icono: "compras" },
      { href: "/suppliers", etiqueta: "Proveedores", icono: "proveedores" },
      { href: "/vigencias", etiqueta: "Garantías y vigencias", icono: "vigencias" },
    ],
  },
  {
    seccion: "Cómo me fue", clave: "analisis", items: [
      { href: "/indicadores", etiqueta: "Indicadores", icono: "indicadores" },
      { href: "/presupuestos", etiqueta: "Presupuestos", icono: "reportes" },
      { href: "/normas", etiqueta: "Cumplimiento normativo", icono: "normas", requiereNormas: true },
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
      { href: "/registros/nueva", etiqueta: "Armar un registro", icono: "registros", requiereRegistros: true },
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
/**
 * Todas las pantallas del menu, en una lista plana.
 *
 * La usa la navegacion por voz para que CUALQUIER pantalla del menu se pueda
 * pedir hablando sin tener que acordarse de apuntarla en otra lista. Se
 * agrego el rondin al menu y a la tabla de permisos, y se olvido el catalogo
 * de voz: «llevame a rondines» no encontraba nada. Con esto, la proxima
 * pantalla nueva ya nace diciendose.
 */
/**
 * Como se llama esta pantalla en ESTA empresa.
 *
 * «Conjuntos» se llama «Mapa de lineas», «Mapa de sistemas» o como esa empresa
 * llame a los suyos. La traduccion la hacia SOLO el menu lateral, asi que en
 * «Lo que mas uso» la misma pantalla aparecia como «Conjuntos»: quien la
 * buscaba por el nombre que ve todos los dias no la encontraba y concluia que
 * no se podia anclar. Es el defecto de siempre —un dato que un solo lector
 * mira— y por eso la decision vive aqui y no en un componente.
 */
export function etiquetaDeItem(item: ItemMenu, nombreDelMapa?: string | null): string {
  return item.porInstalacion && nombreDelMapa?.trim() ? nombreDelMapa : item.etiqueta;
}

export function pantallasDelMenu(): ItemMenu[] {
  return MENU.flatMap((g) => g.items);
}

/**
 * Pantallas que existen pero NO estan en el menu: se llega a ellas por un
 * boton desde otra.
 *
 * El kardex vive dentro de Almacen, detras de un boton. Pedirlo hablando
 * —«abre kardex»— dejaba a la persona en Almacen, que es donde vive, pero no
 * en el kardex: se parecia lo suficiente a «almacen» para ganar el concurso de
 * nombres, y el kardex ni siquiera competia porque no estaba en esta lista.
 *
 * Peor: `OTROS_NOMBRES` de la navegacion por voz YA traia «kardex» apuntando a
 * su ruta. El dato estaba escrito y nadie lo leia, porque los destinos salian
 * solo del menu. Es el defecto de siempre en este proyecto —escribir un campo
 * que ningun lector mira— disfrazado de catalogo.
 *
 * Que se pueda PEDIR no es lo mismo que se pueda VER: quien ve cada una lo
 * sigue decidiendo `puedeVerRuta`, con la misma tabla de arriba.
 */
const SUBPANTALLAS: ItemMenu[] = [
  { href: "/normas/nueva", etiqueta: "Agregar una norma propia", icono: "normas" },
  { href: "/inventory/herramientas/perdidas", etiqueta: "Qué se está perdiendo", icono: "herramientas" },
  // Del dia a dia, aunque no esten en el menu.
  { href: "/search", etiqueta: "Búsqueda", icono: "buscar" },
  { href: "/notificaciones", etiqueta: "Avisos", icono: "avisos" },
  { href: "/work-orders/new", etiqueta: "Nueva orden de trabajo", icono: "ordenes" },

  // Dentro de Almacen, cada una detras de su boton.
  { href: "/inventory/kardex", etiqueta: "Kardex de almacén", icono: "kardex" },
  { href: "/inventory/analisis", etiqueta: "Análisis de almacén", icono: "analisis" },
  { href: "/inventory/proyeccion", etiqueta: "Lo que va a pedir el preventivo", icono: "calendario" },
  { href: "/inventory/indicadores", etiqueta: "Indicadores de almacén", icono: "indicadores" },
  { href: "/inventory/conteos", etiqueta: "Conteos cíclicos", icono: "conteos" },
  { href: "/inventory/traspasos", etiqueta: "Traspasos entre almacenes", icono: "traspasos" },
  { href: "/inventory/duplicados", etiqueta: "Limpieza del catálogo", icono: "limpieza" },
  { href: "/inventory/equivalencias", etiqueta: "Equivalencias sugeridas", icono: "equivalencias" },

  // Dentro de Activos y de Planes.
  { href: "/assets/levantamiento", etiqueta: "Levantamiento de inventario", icono: "levantamiento" },
  { href: "/plans/cobertura", etiqueta: "Equipos y sus planes", icono: "cobertura" },

  // Dentro de Puntos de reporte.
  { href: "/requests/puntos/imprimir", etiqueta: "Imprimir puntos de reporte", icono: "imprimir" },

  // De la demostracion y de la plataforma: `puedeVerRuta` las cierra a quien no toca.
  // La guia se le agrega al menu solo a la cuenta demostrativa, en `menuDe`,
  // asi que el catalogo estatico no la traia.
  { href: "/demo", etiqueta: "Guía de la demostración", icono: "demo" },
  { href: "/demo/presentacion", etiqueta: "Presentación", icono: "demo" },
  { href: "/clients", etiqueta: "Empresas cliente", icono: "clientes" },
  { href: "/clients/cobranza", etiqueta: "Cobranza", icono: "cobranza" },
  { href: "/clients/prospectos", etiqueta: "Prospectos", icono: "prospectos" },
  { href: "/clients/ia", etiqueta: "Consumo de IA", icono: "consumo" },
  { href: "/clients/soporte", etiqueta: "Soporte a clientes", icono: "soporte" },
];

/**
 * TODO lo que se puede pedir hablando: el menu mas lo que vive detras de un
 * boton.
 *
 * `scripts/prueba-navegacion-voz.ts` recorre las pantallas que existen de
 * verdad —los `page.tsx` del proyecto— y exige que cada una este aqui o en
 * `SIN_VOZ`. Una pantalla nueva que nadie apunte detiene la prueba, que es lo
 * unico que evita que esto se vuelva a quedar atras.
 */
export function pantallasQueSePuedenPedir(): ItemMenu[] {
  return [...pantallasDelMenu(), ...SUBPANTALLAS];
}

/**
 * Pantallas que a proposito NO se piden hablando.
 *
 * No se ignoran en silencio: se apuntan, con su razon. Igual que `SIN_AYUDA`
 * en `lib/ayuda.ts`.
 */
export const SIN_VOZ: Record<string, string> = {
  // Hoy no hay ninguna: las 52 pantallas del proyecto se pueden pedir
  // hablando. La lista se queda porque el dia que haya una que no tenga
  // sentido pedir, tiene que quedar APUNTADA con su razon —no ignorada en
  // silencio, que es como se pierden—.
};

export function menuDe(
  rol: string | undefined,
  opciones: { esSuperAdmin?: boolean; esDemo?: boolean; registrosPropios?: boolean; cumplimientoNormas?: boolean } = {},
): GrupoMenu[] {
  const grupos = MENU
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => puedeVerRuta(rol, i.href, opciones)
          && (!i.requiereRegistros || opciones.registrosPropios)
          && (!i.requiereNormas || opciones.cumplimientoNormas),
      ),
    }))
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
