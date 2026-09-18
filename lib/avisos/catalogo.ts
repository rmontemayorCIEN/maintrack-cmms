/**
 * Qué avisa MainTrack, a quién y con qué fuerza. Un solo catálogo.
 *
 * Cada evento dice su módulo, su prioridad de partida, si pide acción, a qué
 * grupo va y si se puede apagar. La lista la leen el emisor
 * (`lib/avisos/emitir.ts`), las preferencias de cada persona, la
 * configuración de la empresa, los webhooks y la documentación de la API: si
 * un evento no está aquí, no existe.
 *
 * Sin dependencias: lo importan también las pantallas.
 *
 * Tres clases de aviso:
 *
 *  - **OBLIGATORIO**: seguridad o responsabilidad directa. No se apaga.
 *  - **OPERATIVO**: trabajo que alguien tiene que hacer. Se puede apagar,
 *    salvo cuando quien lo recibe es el responsable directo o el único que
 *    puede autorizar (eso lo decide el emisor, caso por caso).
 *  - **INFORMATIVO**: para enterarse. Se apaga libremente.
 */

export type Prioridad = "INFORMATIVA" | "BAJA" | "MEDIA" | "ALTA" | "CRITICA";
export const PRIORIDADES: Prioridad[] = ["INFORMATIVA", "BAJA", "MEDIA", "ALTA", "CRITICA"];
export const PESO_PRIORIDAD: Record<Prioridad, number> = { INFORMATIVA: 0, BAJA: 1, MEDIA: 2, ALTA: 3, CRITICA: 4 };
export const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = {
  INFORMATIVA: "Informativa", BAJA: "Baja", MEDIA: "Media", ALTA: "Alta", CRITICA: "Crítica",
};

export type Categoria = "OBLIGATORIO" | "OPERATIVO" | "INFORMATIVO";

export type Modulo = "ORDENES" | "SOLICITUDES" | "PREVENTIVO" | "MEDIDORES" | "ALMACEN" | "COMPRAS" | "ADMINISTRACION" | "RESUMENES";
export const ETIQUETA_MODULO: Record<Modulo, string> = {
  ORDENES: "Órdenes de trabajo", SOLICITUDES: "Solicitudes", PREVENTIVO: "Mantenimiento preventivo",
  MEDIDORES: "Medidores y predictivo", ALMACEN: "Almacén", COMPRAS: "Compras",
  ADMINISTRACION: "Administración", RESUMENES: "Resúmenes",
};

/**
 * A quién va, en grupos que resuelve `lib/avisos/destinatarios.ts`. El primero
 * que tenga a alguien activo es el que recibe; los siguientes son respaldo,
 * no copia: el administrador no es el destinatario universal.
 */
export type Grupo =
  | "RESPONSABLE"      // el asignado del registro
  | "RESPONSABLE_ANTERIOR"
  | "SOLICITANTE"      // quien pidió o creó
  | "SUPERVISORES"     // rol supervisor
  | "REVISORES"        // quien puede revisar solicitudes, empezando por supervisores
  | "AUTORIZADORES"    // quien puede autorizar compras
  | "ALMACEN"          // responsable del almacén y compras
  | "COMPRAS"          // rol compras
  | "ADMINISTRADORES"  // los destinatarios administrativos de la empresa
  | "PROPIETARIO"      // el dueño de la cuenta
  | "USUARIO_AFECTADO" // la persona de quien se habla (cambio de contraseña, de rol)
  | "OPERADORES";      // el operador de la plataforma: solo estado técnico

export type DefinicionEvento = {
  titulo: string;
  /** Una línea para la pantalla de preferencias: qué es. */
  descripcion: string;
  modulo: Modulo;
  prioridad: Prioridad;
  categoria: Categoria;
  requiereAccion: boolean;
  /** Grupos en orden: el primero con alguien activo recibe. */
  destinatarios: Grupo[][];
  /** Explicación para la pantalla: quién lo recibe. */
  quien: string;
  /** Se puede mandar a los webhooks de la empresa. */
  webhook: boolean;
};

const d = (x: DefinicionEvento) => x;

export const EVENTOS = {
  // ───────────────────────────────────────────── Órdenes de trabajo
  OT_ASIGNADA: d({
    titulo: "OT asignada", descripcion: "Le asignan una orden de trabajo.",
    modulo: "ORDENES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["RESPONSABLE"]], quien: "El responsable de la orden.", webhook: true,
  }),
  OT_REASIGNADA: d({
    titulo: "OT reasignada", descripcion: "Una orden que era suya pasó a otra persona.",
    modulo: "ORDENES", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["RESPONSABLE_ANTERIOR"]], quien: "Quien era responsable.", webhook: true,
  }),
  OT_PRIORIDAD_CAMBIADA: d({
    titulo: "Cambio de prioridad", descripcion: "Una orden suya subió o bajó de prioridad de forma importante.",
    modulo: "ORDENES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: false,
    destinatarios: [["RESPONSABLE"]], quien: "El responsable de la orden.", webhook: true,
  }),
  OT_CRITICA_CREADA: d({
    titulo: "OT crítica", descripcion: "Se creó una orden de prioridad crítica.",
    modulo: "ORDENES", prioridad: "CRITICA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores; si no hay, la administración.", webhook: true,
  }),
  OT_POR_VENCER: d({
    titulo: "OT por vencer", descripcion: "Una orden suya vence pronto (según la anticipación de la empresa).",
    modulo: "ORDENES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["RESPONSABLE"], ["SUPERVISORES"]], quien: "El responsable; si no tiene, los supervisores.", webhook: false,
  }),
  OT_VENCIDA: d({
    titulo: "OT vencida", descripcion: "Una orden pasó su fecha compromiso sin terminarse.",
    modulo: "ORDENES", prioridad: "ALTA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["RESPONSABLE"], ["SUPERVISORES"]], quien: "El responsable; si no tiene, los supervisores.", webhook: true,
  }),
  OT_SIN_ACEPTAR: d({
    titulo: "OT sin aceptar", descripcion: "Una orden alta o crítica sigue sin iniciarse ni reconocerse.",
    modulo: "ORDENES", prioridad: "ALTA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["RESPONSABLE"], ["SUPERVISORES"]], quien: "El responsable, y al escalar, los supervisores.", webhook: false,
  }),
  OT_DETENIDA: d({
    titulo: "OT detenida", descripcion: "Una orden quedó en espera o bloqueada.",
    modulo: "ORDENES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: true,
  }),
  OT_LISTA_REVISION: d({
    titulo: "OT lista para revisión", descripcion: "El técnico terminó y la orden espera que alguien la revise y cierre.",
    modulo: "ORDENES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Quien puede cerrar órdenes, empezando por supervisores.", webhook: true,
  }),
  OT_DEVUELTA: d({
    titulo: "OT devuelta", descripcion: "Le regresaron una orden en revisión: faltó información, evidencia o trabajo.",
    modulo: "ORDENES", prioridad: "ALTA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["RESPONSABLE"]], quien: "El responsable de la orden.", webhook: true,
  }),
  OT_CERRADA: d({
    titulo: "OT cerrada", descripcion: "Una orden que usted creó o pidió quedó cerrada.",
    modulo: "ORDENES", prioridad: "INFORMATIVA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["SOLICITANTE"]], quien: "Quien la creó o la pidió.", webhook: true,
  }),

  // ───────────────────────────────────────────── Solicitudes
  SOLICITUD_NUEVA: d({
    titulo: "Solicitud nueva", descripcion: "Llegó una solicitud de trabajo por revisar.",
    modulo: "SOLICITUDES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["REVISORES"]], quien: "Quien revisa solicitudes, empezando por supervisores.", webhook: true,
  }),
  SOLICITUD_CONVERTIDA: d({
    titulo: "Solicitud atendida", descripcion: "Su solicitud se convirtió en orden de trabajo.",
    modulo: "SOLICITUDES", prioridad: "INFORMATIVA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["SOLICITANTE"]], quien: "Quien hizo la solicitud.", webhook: true,
  }),
  SOLICITUD_RECHAZADA: d({
    titulo: "Solicitud rechazada", descripcion: "Su solicitud no procedió, con el motivo.",
    modulo: "SOLICITUDES", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["SOLICITANTE"]], quien: "Quien hizo la solicitud.", webhook: true,
  }),
  SOLICITUD_CRITICA_SIN_ATENDER: d({
    titulo: "Solicitud crítica sin atender", descripcion: "Una solicitud crítica o de riesgo sigue sin revisarse.",
    modulo: "SOLICITUDES", prioridad: "CRITICA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["REVISORES"]], quien: "Quien revisa solicitudes; al escalar, la administración.", webhook: false,
  }),

  // ───────────────────────────────────────────── Preventivo
  PLAN_FALLO_GENERAR: d({
    titulo: "Falló una orden programada", descripcion: "Un plan debía generar su orden y no pudo.",
    modulo: "PREVENTIVO", prioridad: "ALTA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores; si no hay, la administración.", webhook: true,
  }),
  PLAN_SIN_PROGRAMACION: d({
    titulo: "Plan sin programación válida", descripcion: "Un plan activo no tiene próxima fecha ni lectura con qué programarse.",
    modulo: "PREVENTIVO", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: false,
  }),
  ACTIVO_CRITICO_SIN_PLAN: d({
    titulo: "Equipos críticos sin plan", descripcion: "Hay equipos de criticidad A sin plan preventivo (un aviso agrupado).",
    modulo: "PREVENTIVO", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: false,
  }),
  PREVENTIVO_INCUMPLIDO: d({
    titulo: "Preventivo incumplido", descripcion: "Un preventivo pasó su tolerancia sin ejecutarse.",
    modulo: "PREVENTIVO", prioridad: "ALTA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: true,
  }),

  // ───────────────────────────────────────────── Medidores y predictivo
  UMBRAL_CERCA: d({
    titulo: "Lectura cerca del límite", descripcion: "Una condición llegó a su umbral de advertencia.",
    modulo: "MEDIDORES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: true,
  }),
  UMBRAL_EXCEDIDO: d({
    titulo: "Umbral excedido", descripcion: "Una condición rebasó su umbral crítico.",
    modulo: "MEDIDORES", prioridad: "CRITICA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores; si no hay, la administración.", webhook: true,
  }),
  LECTURA_ANORMAL: d({
    titulo: "Lectura anormal", descripcion: "Llegó una lectura imposible o fuera de secuencia y se detuvo la proyección.",
    modulo: "MEDIDORES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: true,
  }),
  MEDIDOR_SIN_LECTURA: d({
    titulo: "Medidores sin lectura", descripcion: "Medidores de planes por uso que no reciben lectura en su periodo (agrupado).",
    modulo: "MEDIDORES", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: false,
  }),
  ALERTA_PREDICTIVA: d({
    titulo: "Alerta predictiva", descripcion: "El predictivo abrió una alerta nueva.",
    modulo: "MEDIDORES", prioridad: "ALTA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores.", webhook: true,
  }),
  ALERTA_CRITICA_SIN_ATENDER: d({
    titulo: "Alerta crítica sin atender", descripcion: "Una alerta predictiva crítica sigue sin reconocerse.",
    modulo: "MEDIDORES", prioridad: "CRITICA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["SUPERVISORES"], ["ADMINISTRADORES"]], quien: "Los supervisores; al escalar, la administración.", webhook: false,
  }),
  CONDICION_NORMALIZADA: d({
    titulo: "Condición normalizada", descripcion: "Una condición en alerta regresó a sus parámetros normales.",
    modulo: "MEDIDORES", prioridad: "INFORMATIVA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["SUPERVISORES"]], quien: "Los supervisores.", webhook: true,
  }),

  // ───────────────────────────────────────────── Almacén y compras
  REFACCION_BAJO_MINIMO: d({
    titulo: "Refacciones bajo mínimo", descripcion: "Refacciones en o por debajo de su mínimo (un aviso agrupado).",
    modulo: "ALMACEN", prioridad: "BAJA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["ALMACEN"], ["SUPERVISORES"]], quien: "Almacén y compras; si no hay, los supervisores.", webhook: true,
  }),
  REFACCION_CRITICA_AGOTADA: d({
    titulo: "Refacción crítica agotada", descripcion: "Se agotó una refacción que usa un equipo crítico o que detiene trabajo.",
    modulo: "ALMACEN", prioridad: "ALTA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["ALMACEN"], ["SUPERVISORES"]], quien: "Almacén y compras; si no hay, los supervisores.", webhook: true,
  }),
  REQUISICION_POR_AUTORIZAR: d({
    titulo: "Compra por autorizar", descripcion: "Una solicitud de compra espera autorización.",
    modulo: "COMPRAS", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["AUTORIZADORES"]], quien: "Quien puede autorizar compras.", webhook: true,
  }),
  REQUISICION_RESUELTA: d({
    titulo: "Compra autorizada o rechazada", descripcion: "Su solicitud de compra se autorizó o se rechazó.",
    modulo: "COMPRAS", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["SOLICITANTE"]], quien: "Quien la pidió.", webhook: true,
  }),
  ORDEN_COMPRA_PENDIENTE: d({
    titulo: "Compra autorizada sin orden", descripcion: "Una compra autorizada sigue sin orden de compra.",
    modulo: "COMPRAS", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["COMPRAS"], ["AUTORIZADORES"]], quien: "Compras; si no hay, quien autoriza.", webhook: false,
  }),
  ENTREGA_PROXIMA: d({
    titulo: "Entrega próxima", descripcion: "Una orden de compra tiene su entrega prometida en los próximos días.",
    modulo: "COMPRAS", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["COMPRAS"], ["ALMACEN"]], quien: "Compras y almacén.", webhook: false,
  }),
  ENTREGA_VENCIDA: d({
    titulo: "Compra vencida", descripcion: "Una orden de compra pasó su fecha prometida sin recibirse completa.",
    modulo: "COMPRAS", prioridad: "ALTA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["COMPRAS"], ["AUTORIZADORES"]], quien: "Compras; si no hay, quien autoriza.", webhook: true,
  }),
  RECEPCION_PARCIAL: d({
    titulo: "Recepción parcial", descripcion: "Se recibió parte de una compra: hubo diferencia contra lo comprado.",
    modulo: "COMPRAS", prioridad: "MEDIA", categoria: "OPERATIVO", requiereAccion: true,
    destinatarios: [["COMPRAS"], ["ALMACEN"]], quien: "Compras y almacén.", webhook: true,
  }),

  // ───────────────────────────────────────────── Administración
  USUARIO_NUEVO: d({
    titulo: "Usuario nuevo", descripcion: "Se dio de alta una persona en la empresa.",
    modulo: "ADMINISTRACION", prioridad: "INFORMATIVA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["ADMINISTRADORES"]], quien: "Los destinatarios administrativos.", webhook: false,
  }),
  USUARIO_DESACTIVADO: d({
    titulo: "Usuario desactivado", descripcion: "Se desactivó una persona: sus órdenes pueden quedar sin responsable.",
    modulo: "ADMINISTRACION", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["ADMINISTRADORES"]], quien: "Los destinatarios administrativos.", webhook: false,
  }),
  ROL_CAMBIADO: d({
    titulo: "Cambio de rol", descripcion: "Cambió el rol de una persona. También se le avisa a ella.",
    modulo: "ADMINISTRACION", prioridad: "MEDIA", categoria: "OBLIGATORIO", requiereAccion: false,
    destinatarios: [["USUARIO_AFECTADO"], ["ADMINISTRADORES"]], quien: "La persona y los destinatarios administrativos.", webhook: false,
  }),
  CONTRASENA_CAMBIADA: d({
    titulo: "Contraseña cambiada", descripcion: "Se cambió o restableció su contraseña. Si no fue usted, avise de inmediato.",
    modulo: "ADMINISTRACION", prioridad: "ALTA", categoria: "OBLIGATORIO", requiereAccion: false,
    destinatarios: [["USUARIO_AFECTADO"]], quien: "La persona dueña de la cuenta.", webhook: false,
  }),
  PRUEBA_POR_TERMINAR: d({
    titulo: "Periodo de prueba por terminar", descripcion: "El periodo de prueba de la cuenta termina pronto.",
    modulo: "ADMINISTRACION", prioridad: "MEDIA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["PROPIETARIO"]], quien: "El dueño de la cuenta.", webhook: false,
  }),
  LIMITE_PLAN_CERCA: d({
    titulo: "Límite del plan cerca", descripcion: "Se usa el 90% o más de lo que permite el plan.",
    modulo: "ADMINISTRACION", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["PROPIETARIO"], ["ADMINISTRADORES"]], quien: "El dueño de la cuenta.", webhook: false,
  }),
  LIMITE_PLAN_ALCANZADO: d({
    titulo: "Límite del plan alcanzado", descripcion: "Ya no caben más registros de ese tipo en el plan.",
    modulo: "ADMINISTRACION", prioridad: "ALTA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["PROPIETARIO"], ["ADMINISTRADORES"]], quien: "El dueño de la cuenta.", webhook: false,
  }),
  INTEGRACION_CON_ERRORES: d({
    titulo: "Integración con errores", descripcion: "Un webhook o una credencial acumula fallas o rebasa sus límites.",
    modulo: "ADMINISTRACION", prioridad: "ALTA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["ADMINISTRADORES"]], quien: "Los destinatarios administrativos.", webhook: false,
  }),
  IMPORTACION_TERMINADA: d({
    titulo: "Importación terminada", descripcion: "Una importación se completó, falló o quedó bloqueada.",
    modulo: "ADMINISTRACION", prioridad: "BAJA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [["SOLICITANTE"]], quien: "Quien la hizo.", webhook: false,
  }),
  CONFIGURACION_INCOMPLETA: d({
    titulo: "Aviso sin destinatario", descripcion: "Un aviso no tuvo a quién llegar: falta configurar un rol o responsable.",
    modulo: "ADMINISTRACION", prioridad: "ALTA", categoria: "OBLIGATORIO", requiereAccion: true,
    destinatarios: [["ADMINISTRADORES"]], quien: "Los destinatarios administrativos.", webhook: false,
  }),

  // ───────────────────────────────────────────── Resúmenes
  RESUMEN_DIARIO: d({
    titulo: "Resumen diario", descripcion: "Lo que requiere su atención hoy, según su rol.",
    modulo: "RESUMENES", prioridad: "INFORMATIVA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [], quien: "Cada persona, con lo que le toca.", webhook: false,
  }),
  RESUMEN_SEMANAL: d({
    titulo: "Resumen semanal", descripcion: "Cómo fue la semana y qué quedó pendiente.",
    modulo: "RESUMENES", prioridad: "INFORMATIVA", categoria: "INFORMATIVO", requiereAccion: false,
    destinatarios: [], quien: "Cada persona, con lo que le toca.", webhook: false,
  }),
} as const satisfies Record<string, DefinicionEvento>;

export type TipoEvento = keyof typeof EVENTOS;

export function esTipoEvento(t: string): t is TipoEvento {
  return t in EVENTOS;
}

/** Los eventos que una empresa puede mandar a sus webhooks. */
export const EVENTOS_WEBHOOK = (Object.keys(EVENTOS) as TipoEvento[]).filter((t) => EVENTOS[t].webhook);

export type Canal = "CAMPANA" | "NAVEGADOR" | "CORREO" | "WEBHOOK";
export const CANALES_PERSONALES: Canal[] = ["NAVEGADOR", "CORREO"];
export const ETIQUETA_CANAL: Record<Canal, string> = {
  CAMPANA: "Centro de avisos", NAVEGADOR: "Aviso del navegador o celular", CORREO: "Correo electrónico", WEBHOOK: "Webhook",
};

export type EstadoEntrega =
  | "PENDIENTE" | "EN_PROCESO" | "ENTREGADA" | "FALLIDA" | "EN_REINTENTO" | "CANCELADA"
  | "OMITIDA_PREFERENCIA" | "SIN_DESTINATARIO";
export const ETIQUETA_ESTADO_ENTREGA: Record<EstadoEntrega, string> = {
  PENDIENTE: "Pendiente", EN_PROCESO: "En proceso", ENTREGADA: "Entregada", FALLIDA: "Fallida",
  EN_REINTENTO: "En reintento", CANCELADA: "Cancelada", OMITIDA_PREFERENCIA: "Omitida por preferencia",
  SIN_DESTINATARIO: "Sin destinatario válido",
};

/** Lo que el kind viejo de la campana significa en prioridades. */
export function prioridadDeKind(kind?: string): Prioridad {
  return kind === "CRITICAL" ? "CRITICA" : kind === "WARNING" ? "ALTA" : kind === "SUCCESS" ? "INFORMATIVA" : "MEDIA";
}
export function kindDePrioridad(p: Prioridad): string {
  return p === "CRITICA" ? "CRITICAL" : p === "ALTA" ? "WARNING" : p === "INFORMATIVA" ? "SUCCESS" : "INFO";
}
