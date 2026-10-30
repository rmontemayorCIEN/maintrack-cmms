import { prisma } from "../db";
import { estadoDeProcesos } from "../procesos";
import { pushConfigurado } from "../push";
import { periodoActual } from "../ia/consumo";
import {
  armarReporte, autorizadoTorre, configurado, revisar,
  type EstadoRevision, type Revision,
} from "./contrato";

/**
 * El reporte de salud que le contesta MainTrack a la Torre de Control.
 *
 * `/api/salud` (el «hombre muerto») sigue igual: contesta 200 o 503 para la
 * revision de disponibilidad de Google. Esto es el detalle: una revision por
 * cosa que puede fallar, con su estado, para que la Torre diga QUE falla y
 * no solo que algo falla.
 *
 * Todo sale de lo que la app ya registra —`ProcesoProgramado`,
 * `EntregaAviso`, `PushSubscription`, `AiUsage`, `Webhook`— y no se llama a
 * ningun tercero: preguntarle a Anthropic o a Google si estan vivos cuesta
 * dinero o cuota, y lo que importa es si NUESTROS envios salen.
 *
 * Lo que la app no tiene no se reporta, en vez de pintarlo en verde:
 *  - WhatsApp y llamadas (Vapi): MainTrack no los tiene.
 *  - Correo: no hay proveedor contratado (`AVISOS_CORREO`), el canal no saca
 *    nada y no hay envios que medir.
 *  - Llaves con fecha de vencimiento: ninguna de las que usa vence sola
 *    (VAPID, Anthropic, AUTH_SECRET); la app no tiene una fecha que leer.
 *
 * Reglas del contrato que aqui se cuidan: solo conteos, porcentajes y fechas.
 * Ni nombres de empresa, ni identificadores, ni el texto de un error (puede
 * traer un correo o un folio): `ultimoError` y `errorDetalle` no salen.
 */

export const APP_TORRE = "maintrack";

const HORA = 60 * 60_000;
const DIA = 24 * HORA;

/** Una revision ya armada: su encabezado, la funcion y su limite de tiempo. */
export type DefinicionRevision = {
  base: Pick<Revision, "clave" | "nombre" | "grupo">;
  fn: (ahora: Date) => Promise<Omit<Revision, "clave" | "nombre" | "grupo">>;
  milisegundos?: number;
};

// ───────────────────────────────────────────── Umbrales
//
// Por que estos numeros:
//
//  - Base de datos: Cloud SQL contesta `SELECT 1` en milisegundos. Pasar de
//    1 s ya es una base saturada o una conexion que se esta reabriendo; si no
//    contesta en 3 s, `revisar` lo corta y queda «desconocido».
//  - Procesos: el mismo criterio de `/api/salud` (lib/procesos.ts). Callado =
//    mas de tres periodos sin terminar; tres fallas seguidas = falla. Una o
//    dos fallas seguidas son atencion: el siguiente intento puede corregirlo.
//  - Fallas de envio (push) e IA: porcentaje sobre lo intentado en 24 h, con
//    un minimo de casos para que una sola falla en un dia tranquilo no pinte
//    rojo. Atencion desde 10 % (y 3 casos); falla desde 50 % (y 5 casos).
//  - Suscripciones al celular con tres o mas fallos seguidos: el navegador no
//    dijo «ya no existe» (esas se borran solas) pero tampoco recibe. Atencion
//    si son al menos el 20 % del total y al menos 3.
//  - Cola atorada: el proceso de avisos corre cada 5 min y rescata lo que
//    lleva 15 en proceso. Algo listo para enviarse desde hace mas de 30 min
//    (seis vueltas) esta atorado. Una o mas: atencion; 25 o mas: falla.
//  - Gasto de IA: atencion desde 80 % del presupuesto del mes, falla al
//    pasarlo. Sin presupuesto definido no se puede juzgar: «desconocido».

export const UMBRALES = {
  baseMsAtencion: 1000,
  baseLimiteMs: 3000,
  proporcionAtencion: 0.1,
  minimoAtencion: 3,
  proporcionFalla: 0.5,
  minimoFalla: 5,
  fallosSuscripcion: 3,
  proporcionSuscripciones: 0.2,
  minutosAtorado: 30,
  atoradosFalla: 25,
  gastoAtencion: 0.8,
} as const;

/** Categorias de falla que NO son de la plataforma: la persona no tiene aparato, o la empresa apago el canal. */
const FALLAS_AJENAS = ["SIN_DISPOSITIVOS", "CANAL_APAGADO", "USUARIO_INACTIVO", "SIN_PROVEEDOR"];

/** ok / atencion / falla por proporcion de fallas, con minimo de casos. */
export function estadoPorProporcion(fallidas: number, total: number): EstadoRevision {
  if (!total || !fallidas) return "ok";
  const p = fallidas / total;
  if (p >= UMBRALES.proporcionFalla && fallidas >= UMBRALES.minimoFalla) return "falla";
  if (p >= UMBRALES.proporcionAtencion && fallidas >= UMBRALES.minimoAtencion) return "atencion";
  return "ok";
}

const porciento = (parte: number, total: number) => (total ? Math.round((parte / total) * 100) : 0);

// ───────────────────────────────────────────── Secretos

/**
 * Lo que la app necesita en produccion para funcionar. Solo se pregunta si
 * existe, nunca su valor. El nombre de la variable no es secreto.
 */
export const SECRETOS_REQUERIDOS: Array<{ variable: string; sinElla: "falla" | "atencion"; para: string }> = [
  { variable: "DATABASE_URL", sinElla: "falla", para: "la base" },
  { variable: "AUTH_SECRET", sinElla: "falla", para: "las sesiones" },
  { variable: "CRON_SECRET", sinElla: "falla", para: "los procesos programados" },
  { variable: "ANTHROPIC_API_KEY", sinElla: "atencion", para: "la IA" },
  { variable: "VAPID_PUBLIC_KEY", sinElla: "atencion", para: "los avisos al celular" },
  { variable: "VAPID_PRIVATE_KEY", sinElla: "atencion", para: "los avisos al celular" },
  { variable: "GCS_BUCKET", sinElla: "atencion", para: "los archivos" },
];

// ───────────────────────────────────────────── Las revisiones

/**
 * Lee los procesos una sola vez por reporte: las cuatro revisiones de
 * procesos comparten la misma consulta.
 */
function procesosUnaVez(ahora: Date) {
  let promesa: ReturnType<typeof estadoDeProcesos> | null = null;
  return () => (promesa ??= estadoDeProcesos(ahora));
}

export function revisionesDeMaintrack(ahora: Date): DefinicionRevision[] {
  const procesos = procesosUnaVez(ahora);
  const hace24 = new Date(ahora.getTime() - DIA);

  const base: DefinicionRevision = {
    base: { clave: "base-de-datos", nombre: "Base de datos", grupo: "infraestructura" },
    milisegundos: UMBRALES.baseLimiteMs,
    fn: async () => {
      const t = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const ms = Date.now() - t;
      return {
        estado: ms >= UMBRALES.baseMsAtencion ? "atencion" : "ok",
        detalle: `Contestó en ${ms} ms`,
        valor: ms, unidad: "ms",
      };
    },
  };

  const deProcesos: DefinicionRevision[] = [
    { clave: "cron:avisos", sufijo: "avisos" },
    { clave: "cron:scheduler", sufijo: "scheduler" },
    { clave: "cron:disponibles", sufijo: "disponibles" },
    { clave: "cron:diagnostico", sufijo: "diagnostico" },
  ].map(({ clave, sufijo }) => ({
    base: { clave: `proceso-${sufijo}`, nombre: nombreDeProceso(clave), grupo: "procesos" as const },
    fn: async () => {
      const p = (await procesos()).find((x) => x.clave === clave);
      if (!p) throw new Error(`proceso no vigilado: ${clave}`);
      const comun = { arreglarEn: "/clients", valor: p.desdeMinutos, unidad: "min" };
      if (p.sinDatos) {
        return { ...comun, estado: "desconocido" as const, detalle: "Nunca ha terminado una corrida: todavía no hay de dónde juzgarlo." };
      }
      const desde = p.ultimoFin?.toISOString() ?? null;
      if (p.callado) {
        return { ...comun, estado: "falla" as const, desde, detalle: `Lleva ${p.desdeMinutos} min sin terminar una corrida; se espera cada ${p.cadaMinutos} min.` };
      }
      if (p.fallasSeguidas >= 3) {
        return { ...comun, estado: "falla" as const, detalle: `${p.fallasSeguidas} corridas seguidas con falla.` };
      }
      if (p.fallasSeguidas > 0) {
        return { ...comun, estado: "atencion" as const, detalle: `La última corrida falló (${p.fallasSeguidas} seguida${p.fallasSeguidas === 1 ? "" : "s"}).` };
      }
      return { ...comun, estado: "ok" as const, detalle: `Terminó bien hace ${p.desdeMinutos} min.` };
    },
  }));

  const pushFallidos: DefinicionRevision = {
    base: { clave: "push-envios", nombre: "Avisos al celular", grupo: "notificaciones" },
    fn: async () => {
      if (!pushConfigurado()) {
        return { estado: "falla", detalle: "Sin llaves VAPID: no sale ningún aviso al celular.", valor: null };
      }
      // Lo que llego a intentarse en 24 h. Las fallas «ajenas» (la persona no
      // tiene aparato, la empresa apago el canal) no son de la plataforma.
      const [entregadas, fallidas] = await Promise.all([
        prisma.entregaAviso.count({ where: { canal: "NAVEGADOR", estado: "ENTREGADA", updatedAt: { gte: hace24, lte: ahora } } }),
        prisma.entregaAviso.count({
          where: {
            canal: "NAVEGADOR", estado: "FALLIDA", updatedAt: { gte: hace24, lte: ahora },
            OR: [{ errorCategoria: null }, { errorCategoria: { notIn: FALLAS_AJENAS } }],
          },
        }),
      ]);
      const total = entregadas + fallidas;
      return {
        estado: estadoPorProporcion(fallidas, total),
        detalle: total ? `${fallidas} de ${total} envíos fallaron en 24 h (${porciento(fallidas, total)} %).` : "Sin envíos en 24 h.",
        valor: fallidas, unidad: "fallidos",
        arreglarEn: "/clients",
      };
    },
  };

  const suscripciones: DefinicionRevision = {
    base: { clave: "push-suscripciones", nombre: "Celulares que no reciben", grupo: "notificaciones" },
    fn: async () => {
      const [total, conFallos] = await Promise.all([
        prisma.pushSubscription.count(),
        prisma.pushSubscription.count({ where: { fallos: { gte: UMBRALES.fallosSuscripcion } } }),
      ]);
      const atencion = total > 0 && conFallos >= UMBRALES.minimoAtencion && conFallos / total >= UMBRALES.proporcionSuscripciones;
      return {
        estado: atencion ? "atencion" : "ok",
        detalle: total
          ? `${conFallos} de ${total} celulares llevan ${UMBRALES.fallosSuscripcion} o más envíos fallidos seguidos.`
          : "No hay celulares dados de alta.",
        valor: conFallos, unidad: "celulares",
      };
    },
  };

  const atorados: DefinicionRevision = {
    base: { clave: "avisos-atorados", nombre: "Cola de avisos", grupo: "notificaciones" },
    fn: async () => {
      const limite = new Date(ahora.getTime() - UMBRALES.minutosAtorado * 60_000);
      const filtro = {
        OR: [
          { estado: { in: ["PENDIENTE", "EN_REINTENTO"] }, programadaPara: { lt: limite } },
          { estado: "EN_PROCESO", intentadaEl: { lt: limite } },
        ],
      };
      const [cuantos, masViejo] = await Promise.all([
        prisma.entregaAviso.count({ where: filtro }),
        prisma.entregaAviso.findFirst({ where: filtro, orderBy: { programadaPara: "asc" }, select: { programadaPara: true } }),
      ]);
      const estado: EstadoRevision = cuantos >= UMBRALES.atoradosFalla ? "falla" : cuantos > 0 ? "atencion" : "ok";
      return {
        estado,
        detalle: cuantos
          ? `${cuantos} entrega${cuantos === 1 ? "" : "s"} lista${cuantos === 1 ? "" : "s"} para salir hace más de ${UMBRALES.minutosAtorado} min sin enviarse.`
          : "Nada atorado en la cola.",
        valor: cuantos, unidad: "entregas",
        desde: masViejo?.programadaPara.toISOString() ?? null,
        arreglarEn: "/clients",
      };
    },
  };

  const webhooks: DefinicionRevision = {
    base: { clave: "webhooks-suspendidos", nombre: "Webhooks de clientes", grupo: "integraciones" },
    fn: async () => {
      const [suspendidos, activos] = await Promise.all([
        prisma.webhook.count({ where: { estado: "SUSPENDIDO" } }),
        prisma.webhook.count({ where: { estado: "ACTIVO" } }),
      ]);
      return {
        estado: suspendidos ? "atencion" : "ok",
        detalle: suspendidos
          ? `${suspendidos} webhook${suspendidos === 1 ? "" : "s"} suspendido${suspendidos === 1 ? "" : "s"} por fallas seguidas; ${activos} activo${activos === 1 ? "" : "s"}.`
          : `Ninguno suspendido; ${activos} activo${activos === 1 ? "" : "s"}.`,
        valor: suspendidos, unidad: "webhooks",
        arreglarEn: "/clients",
      };
    },
  };

  const iaErrores: DefinicionRevision = {
    base: { clave: "ia-errores", nombre: "Errores de IA", grupo: "ia" },
    fn: async () => {
      // VOZ guarda caracteres sintetizados en la misma tabla y nunca falla
      // aqui; se deja fuera para no diluir el porcentaje.
      const donde = { createdAt: { gte: hace24, lte: ahora }, funcion: { not: "VOZ" } };
      const [total, fallidas] = await Promise.all([
        prisma.aiUsage.count({ where: donde }),
        prisma.aiUsage.count({ where: { ...donde, ok: false } }),
      ]);
      return {
        estado: estadoPorProporcion(fallidas, total),
        detalle: total ? `${fallidas} de ${total} llamadas a la IA fallaron en 24 h (${porciento(fallidas, total)} %).` : "Sin llamadas a la IA en 24 h.",
        valor: fallidas, unidad: "fallidas",
        arreglarEn: "/clients/ia",
      };
    },
  };

  const iaGasto: DefinicionRevision = {
    base: { clave: "ia-presupuesto", nombre: "Gasto de IA del mes", grupo: "ia" },
    fn: async () => {
      const periodo = periodoActual(ahora);
      const suma = await prisma.aiUsage.aggregate({ where: { periodo }, _sum: { costoUsd: true } });
      const gasto = Math.round((suma._sum.costoUsd ?? 0) * 100) / 100;
      const presupuesto = Number(process.env.IA_PRESUPUESTO_MENSUAL_USD);
      const comun = { valor: gasto, unidad: "USD", arreglarEn: "/clients/ia" };
      if (!Number.isFinite(presupuesto) || presupuesto <= 0) {
        return { ...comun, estado: "desconocido" as const, detalle: `Gasto de ${periodo}: ${gasto.toFixed(2)} USD. Sin presupuesto definido (IA_PRESUPUESTO_MENSUAL_USD) no se puede juzgar.` };
      }
      const uso = gasto / presupuesto;
      const estado: EstadoRevision = uso >= 1 ? "falla" : uso >= UMBRALES.gastoAtencion ? "atencion" : "ok";
      return { ...comun, estado, detalle: `Gasto de ${periodo}: ${gasto.toFixed(2)} de ${presupuesto.toFixed(2)} USD (${Math.round(uso * 100)} %).` };
    },
  };

  const secretos: DefinicionRevision = {
    base: { clave: "secretos-requeridos", nombre: "Secretos y configuración", grupo: "seguridad" },
    fn: async () => {
      const faltan = SECRETOS_REQUERIDOS.filter((s) => !configurado(s.variable));
      const estado: EstadoRevision = faltan.some((s) => s.sinElla === "falla") ? "falla" : faltan.length ? "atencion" : "ok";
      return {
        estado,
        detalle: faltan.length
          ? `Falta: ${faltan.map((s) => `${s.variable} (${s.para})`).join(", ")}.`
          : `Los ${SECRETOS_REQUERIDOS.length} configurados.`,
        valor: faltan.length, unidad: "faltan",
      };
    },
  };

  return [base, ...deProcesos, pushFallidos, suscripciones, atorados, webhooks, iaErrores, iaGasto, secretos];
}

function nombreDeProceso(clave: string): string {
  const nombres: Record<string, string> = {
    "cron:avisos": "Proceso: avisos y cola de entregas",
    "cron:scheduler": "Proceso: programador de preventivos",
    "cron:disponibles": "Proceso: actividades que ya se pueden hacer",
    "cron:diagnostico": "Proceso: diagnóstico semanal",
  };
  return nombres[clave] ?? clave;
}

/** Corre todas las revisiones a la vez, cada una con su limite y su try/catch (`revisar`). */
export async function correrRevisiones(ahora: Date, lista = revisionesDeMaintrack(ahora)): Promise<Revision[]> {
  return Promise.all(lista.map((r) => revisar(r.base, () => r.fn(ahora), r.milisegundos)));
}

/**
 * Lo que contesta `/api/salud/detalle`. La ruta solo llama esto, y la prueba
 * llama lo mismo.
 *
 * 404 y no 401: quien no trae el token no necesita saber que la ruta existe.
 * Sin TORRE_SALUD_TOKEN configurado, nadie pasa.
 */
export async function responderSalud(
  req: Request,
  opciones: { ahora?: Date; lista?: DefinicionRevision[] } = {},
): Promise<Response> {
  const sinCache = { "Cache-Control": "no-store" };
  if (!autorizadoTorre(req)) return new Response(null, { status: 404, headers: sinCache });
  const ahora = opciones.ahora ?? new Date();
  const revisiones = await correrRevisiones(ahora, opciones.lista ?? revisionesDeMaintrack(ahora));
  return Response.json(armarReporte(APP_TORRE, revisiones, ahora), { headers: sinCache });
}
