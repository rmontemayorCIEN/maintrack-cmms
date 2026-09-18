/**
 * La puerta de la API externa (`/api/v1/*`). Todas las rutas pasan por aquí.
 *
 * Es aparte de `withAuth` a propósito: la interfaz usa la sesión de una
 * persona; la API usa la credencial de un sistema. Nunca se mezclan: una
 * credencial no abre pantallas y una sesión no abre la API.
 *
 * En orden: quién llama (credencial), qué puede (alcance), cuánto (límites
 * por credencial y por empresa), si ya lo pidió antes (idempotencia) y
 * registro de uso. Los errores siempre tienen la misma forma:
 *
 *   { "error": { "codigo": "ALCANCE_INSUFICIENTE", "mensaje": "…" } }
 */
import { NextResponse } from "next/server";
import { prisma } from "../db";
import { consumirLimite } from "./limites";
import { identificar, type Identidad } from "./credenciales";
import { LIMITES_API, type Alcance } from "./alcances";
import { emitirAviso } from "../avisos/emitir";

export const VERSION_API = "1";

export class ErrorApi extends Error {
  constructor(readonly estado: number, readonly codigo: string, message: string, readonly detalle?: unknown) {
    super(message);
  }
}

export type RespuestaApi = { estado: number; cuerpo: unknown };

type Opciones = {
  alcance: Alcance;
  /** Nombre corto para límites y registro: "lecturas", "ordenes"… */
  ruta: string;
  /** Exige Idempotency-Key (los eventos entrantes). */
  exigeIdempotencia?: boolean;
};

const error = (estado: number, codigo: string, mensaje: string, extra: Record<string, string> = {}, detalle?: unknown) =>
  NextResponse.json({ error: { codigo, mensaje, ...(detalle !== undefined ? { detalle } : {}) } }, {
    status: estado, headers: { "MainTrack-Version": VERSION_API, ...extra },
  });

async function registrar(organizationId: string | null, credencialId: string | null, metodo: string, ruta: string, estado: number, resultado: string) {
  await prisma.usoApi.create({ data: { organizationId, credencialId, metodo, ruta, estado, resultado } }).catch(() => undefined);
}

export async function conCredencial(
  request: Request,
  opciones: Opciones,
  manejar: (quien: Identidad, cuerpo: unknown) => Promise<RespuestaApi>,
): Promise<NextResponse> {
  const metodo = request.method;
  const ruta = new URL(request.url).pathname;
  const quien = await identificar(request.headers.get("authorization"));
  if (!("alcances" in quien)) {
    await registrar(quien.organizationId ?? null, quien.credencialId ?? null, metodo, ruta, quien.estado, "RECHAZADA");
    return error(quien.estado, quien.codigo, quien.mensaje);
  }
  if (!quien.alcances.includes(opciones.alcance)) {
    await registrar(quien.organizationId, quien.credencialId, metodo, ruta, 403, "RECHAZADA");
    return error(403, "ALCANCE_INSUFICIENTE", `Esta credencial no tiene el permiso «${opciones.alcance}».`);
  }

  // Límites: por credencial (por ruta) y por empresa. Una empresa no le quita cupo a otra.
  const porCred = opciones.ruta === "lecturas" ? LIMITES_API.lecturasPorCredencial : LIMITES_API.porCredencial;
  const [cred, org] = await Promise.all([
    consumirLimite(`api:cred:${quien.credencialId}:${opciones.ruta}`, porCred, 60),
    consumirLimite(`api:org:${quien.organizationId}`, LIMITES_API.porEmpresa, 60),
  ]);
  const encabezados = {
    "X-Limite": String(cred.limite), "X-Limite-Restante": String(Math.max(0, cred.limite - cred.usados)),
    "X-Limite-Reinicio": String(Math.ceil(cred.reintentarEl.getTime() / 1000)),
  };
  if (!cred.permitido || !org.permitido) {
    const cual = !cred.permitido ? cred : org;
    await registrar(quien.organizationId, quien.credencialId, metodo, ruta, 429, "LIMITE");
    await vigilarAbuso(quien);
    return error(429, "LIMITE_ALCANZADO",
      !cred.permitido ? `Esta credencial alcanzó ${cred.limite} peticiones por minuto en esta ruta.` : `La empresa alcanzó ${org.limite} peticiones por minuto.`,
      { ...encabezados, "Retry-After": String(cual.segundos) });
  }

  // Idempotencia: la misma clave devuelve la misma respuesta, sin repetir el efecto.
  const clave = request.headers.get("idempotency-key")?.trim() || null;
  if (opciones.exigeIdempotencia && !clave) {
    await registrar(quien.organizationId, quien.credencialId, metodo, ruta, 400, "RECHAZADA");
    return error(400, "FALTA_IDEMPOTENCIA", "Mande el encabezado Idempotency-Key con un identificador único por evento.", encabezados);
  }
  if (clave && clave.length > 120) return error(400, "IDEMPOTENCIA_INVALIDA", "Idempotency-Key admite hasta 120 caracteres.", encabezados);
  if (clave && metodo !== "GET") {
    const previa = await prisma.claveIdempotencia.findUnique({ where: { credencialId_clave: { credencialId: quien.credencialId, clave } } });
    if (previa) {
      if (previa.ruta !== ruta) return error(409, "IDEMPOTENCIA_REUSADA", "Esa Idempotency-Key ya se usó en otra ruta.", encabezados);
      await registrar(quien.organizationId, quien.credencialId, metodo, ruta, previa.estado, "OK");
      return new NextResponse(previa.respuesta, {
        status: previa.estado,
        headers: { "Content-Type": "application/json", "MainTrack-Version": VERSION_API, "Idempotencia-Repetida": "true", ...encabezados },
      });
    }
  }

  let cuerpo: unknown = undefined;
  if (metodo !== "GET") {
    try {
      cuerpo = await request.json();
    } catch {
      await registrar(quien.organizationId, quien.credencialId, metodo, ruta, 400, "RECHAZADA");
      return error(400, "JSON_INVALIDO", "El cuerpo debe ser JSON válido.", encabezados);
    }
  }

  let r: RespuestaApi;
  try {
    r = await manejar(quien, cuerpo);
  } catch (e) {
    if (e instanceof ErrorApi) {
      r = { estado: e.estado, cuerpo: { error: { codigo: e.codigo, mensaje: e.message, ...(e.detalle !== undefined ? { detalle: e.detalle } : {}) } } };
    } else {
      console.error("[api v1]", ruta, e instanceof Error ? e.message : e);
      await registrar(quien.organizationId, quien.credencialId, metodo, ruta, 500, "ERROR");
      return error(500, "ERROR_INTERNO", "No se pudo completar la petición. Intente de nuevo; si persiste, avise a soporte.", encabezados);
    }
  }

  const texto = JSON.stringify(r.cuerpo);
  if (clave && metodo !== "GET" && r.estado < 500) {
    await prisma.claveIdempotencia.create({
      data: { organizationId: quien.organizationId, credencialId: quien.credencialId, clave, ruta, estado: r.estado, respuesta: texto },
    }).catch(() => undefined);
  }
  await prisma.credencialApi.update({ where: { id: quien.credencialId }, data: { ultimoUsoEl: new Date(), usos: { increment: 1 } } }).catch(() => undefined);
  await registrar(quien.organizationId, quien.credencialId, metodo, ruta, r.estado, r.estado < 400 ? "OK" : "RECHAZADA");
  return new NextResponse(texto, {
    status: r.estado,
    headers: { "Content-Type": "application/json", "MainTrack-Version": VERSION_API, ...encabezados },
  });
}

/**
 * Rebasar el límite de vez en cuando es una ráfaga; rebasarlo 50 veces en una
 * hora es una integración mal configurada o abuso. Entonces se avisa a la
 * administración, una vez por hora.
 */
async function vigilarAbuso(quien: Identidad) {
  const golpes = await consumirLimite(`api:abuso:${quien.credencialId}`, 50, 3600);
  if (golpes.usados !== 50) return;
  await emitirAviso({
    organizationId: quien.organizationId, tipo: "INTEGRACION_CON_ERRORES", entidad: "CredencialApi", entidadId: quien.credencialId,
    version: golpes.reintentarEl.toISOString(),
    titulo: `La integración «${quien.nombre}» rebasa sus límites`,
    cuerpo: "Rebasó su límite de peticiones 50 veces en la última hora: la mayoría de sus llamadas se están rechazando.",
    porQue: "Puede ser una integración mal configurada (reintentando sin esperar) o un uso indebido de la credencial.",
    accion: "Revise la integración con su proveedor; si no la reconoce, revoque la credencial.",
    enlace: "/settings?s=integracion",
  });
}

/** Paginación por cursor: `?limite=50&cursor=<id>`. */
export function paginacion(url: URL) {
  const limite = Math.min(200, Math.max(1, Number(url.searchParams.get("limite")) || 50));
  const cursor = url.searchParams.get("cursor") || undefined;
  return { take: limite + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), limite };
}

export function pagina<T extends { id: string }>(filas: T[], limite: number) {
  const hay = filas.length > limite;
  const datos = hay ? filas.slice(0, limite) : filas;
  return { datos, siguienteCursor: hay ? datos[datos.length - 1].id : null };
}
