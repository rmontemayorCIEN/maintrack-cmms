import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { nextRequestNumber } from "./numbering";
import { clasificar, construirRuta, guardarArchivo } from "./almacenamiento";
import { notify } from "./audit";
import { evaluarRiesgo } from "./riesgo";

/**
 * Portal publico de reportes.
 *
 * Es la unica ruta del sistema que escribe en la base sin sesion, y por eso
 * las tres reglas de abajo no son negociables:
 *
 *  1. La organizacion sale del token del punto de reporte, NUNCA de lo que
 *     mande el navegador. Es el mismo principio que ya rige a la IA.
 *  2. Hay limite de frecuencia. Sin el, quien tenga la liga puede llenar la
 *     bandeja de mantenimiento en un minuto.
 *  3. Una solicitud jamas se convierte en orden sola. Cae en revision y
 *     mantenimiento decide, que ademas resuelve el reporte duplicado: tres
 *     personas reportan el mismo aire y se atiende como uno.
 */

export class ErrorDePortal extends Error {}

/** Tokens de 24 caracteres: caben en una URL corta y no se adivinan. */
const token = () => randomBytes(18).toString("base64url");

const LIMITE_POR_PUNTO = 10;
const VENTANA_MINUTOS = 10;

export async function crearPuntoDeReporte(params: {
  organizationId: string;
  userId: string;
  nombre: string;
  siteId?: string | null;
  locationId?: string | null;
  assetId?: string | null;
  nota?: string | null;
}) {
  // El sitio, la ubicacion y el activo se validan contra la organizacion: un
  // identificador de otra empresa no puede terminar pegado en un QR.
  if (params.assetId) {
    const a = await prisma.asset.findFirst({ where: { id: params.assetId, organizationId: params.organizationId }, select: { id: true } });
    if (!a) throw new ErrorDePortal("El activo indicado no existe");
  }
  if (params.locationId) {
    const l = await prisma.location.findFirst({ where: { id: params.locationId, organizationId: params.organizationId }, select: { id: true } });
    if (!l) throw new ErrorDePortal("La ubicacion indicada no existe");
  }
  if (params.siteId) {
    const st = await prisma.site.findFirst({ where: { id: params.siteId, organizationId: params.organizationId }, select: { id: true } });
    if (!st) throw new ErrorDePortal("El sitio indicado no existe");
  }

  return prisma.reportPoint.create({
    data: {
      organizationId: params.organizationId,
      token: token(),
      nombre: params.nombre.trim(),
      siteId: params.siteId || null,
      locationId: params.locationId || null,
      assetId: params.assetId || null,
      nota: params.nota || null,
      createdById: params.userId,
    },
    select: { id: true, token: true, nombre: true },
  });
}

/**
 * El punto de reporte de un activo, creandolo si es la primera vez.
 *
 * Todo activo tiene su codigo QR sin que nadie tenga que darlo de alta: el
 * activo ya trae su sitio, su ubicacion y su nombre, y pedirle al usuario que
 * capture un "punto" con esos mismos datos seria capturar dos veces lo mismo.
 *
 * Se genera al pedirlo y no al crear el activo, a proposito: asi funciona
 * igual para los activos que ya existian que para los que vengan, sin tocar
 * las cuatro rutas por las que puede nacer un activo ni rellenar nada.
 */
export async function puntoDeActivo(organizationId: string, assetId: string, userId?: string | null) {
  const existente = await prisma.reportPoint.findFirst({
    where: { organizationId, assetId },
    orderBy: { createdAt: "asc" },
    select: { id: true, token: true, activo: true },
  });
  if (existente) return existente;

  const activo = await prisma.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { id: true, code: true, name: true, siteId: true, locationId: true },
  });
  if (!activo) throw new ErrorDePortal("Activo no encontrado");

  return prisma.reportPoint.create({
    data: {
      organizationId,
      token: token(),
      nombre: `${activo.code} · ${activo.name}`.slice(0, 80),
      siteId: activo.siteId,
      locationId: activo.locationId,
      assetId: activo.id,
      createdById: userId ?? null,
    },
    select: { id: true, token: true, activo: true },
  });
}

/** El contexto que el QR le da al formulario. Solo lectura, sin sesion. */
export async function contextoDelPunto(tok: string) {
  const punto = await prisma.reportPoint.findUnique({
    where: { token: tok },
    select: {
      id: true, nombre: true, activo: true, organizationId: true,
      organization: { select: { name: true, logoUrl: true } },
      site: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      asset: { select: { id: true, code: true, name: true } },
    },
  });
  if (!punto || !punto.activo) return null;
  return punto;
}

/**
 * Levanta la solicitud desde el portal.
 *
 * Nombre y celular son obligatorios: una solicitud que nadie puede aclarar por
 * telefono acaba cerrandose sin resolverse.
 */
export async function levantarSolicitud(params: {
  tokenPunto: string;
  titulo: string;
  descripcion?: string | null;
  nombre: string;
  celular: string;
  correo?: string | null;
  foto?: { base64: string; tipo: string } | null;
}) {
  const punto = await contextoDelPunto(params.tokenPunto);
  if (!punto) throw new ErrorDePortal("Este codigo ya no esta activo. Pida uno nuevo a mantenimiento.");

  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000);
  const recientes = await prisma.workRequest.count({
    where: { reportPointId: punto.id, createdAt: { gte: desde } },
  });
  if (recientes >= LIMITE_POR_PUNTO) {
    throw new ErrorDePortal(
      "Se recibieron demasiados reportes de este punto en los ultimos minutos. Espere un momento antes de enviar otro.",
    );
  }

  const numero = await nextRequestNumber(punto.organizationId);
  const seguimiento = token();

  // El riesgo se evalua en el acto y sin IA: un "huele a gas" no puede esperar
  // a que alguien abra la bandeja, ni el reportante a que responda un modelo.
  const riesgo = evaluarRiesgo(params.titulo, params.descripcion);

  const solicitud = await prisma.workRequest.create({
    data: {
      organizationId: punto.organizationId,
      number: numero,
      title: params.titulo.trim(),
      description: params.descripcion?.trim() || null,
      // El lugar lo pone el QR, no quien reporta: por eso no hace falta que
      // sepa como se llama el equipo.
      assetId: punto.asset?.id ?? null,
      siteId: punto.site?.id ?? null,
      locationId: punto.location?.id ?? null,
      reportPointId: punto.id,
      reporterNombre: params.nombre.trim(),
      reporterCelular: params.celular.trim(),
      reporterCorreo: params.correo?.trim() || null,
      publicToken: seguimiento,
      riesgo: riesgo.nivel,
      riesgoMotivo: riesgo.motivo,
      // Un reporte con riesgo entra como critico: la prioridad la pone lo que
      // se describe, no lo que el reportante creyo que era grave.
      priority: riesgo.nivel === "ALTO" ? "CRITICAL" : "MEDIUM",
    },
    select: { id: true, number: true },
  });

  if (params.foto) {
    try {
      const datos = Buffer.from(params.foto.base64, "base64");
      const ruta = construirRuta(punto.organizationId, "solicitudes", `reporte.${params.foto.tipo.split("/")[1] ?? "jpg"}`);
      await guardarArchivo(ruta, datos, params.foto.tipo);
      await prisma.attachment.create({
        data: {
          organizationId: punto.organizationId,
          workRequestId: solicitud.id,
          name: `${numero}.${params.foto.tipo.split("/")[1] ?? "jpg"}`,
          storagePath: ruta,
          mimeType: params.foto.tipo,
          kind: clasificar(params.foto.tipo),
          size: datos.length,
          note: `Foto tomada al reportar por ${params.nombre.trim()}`,
        },
      });
    } catch {
      // Si el almacen falla, la solicitud ya quedo levantada. Perder la foto es
      // molesto; perder el reporte es peor.
    }
  }

  // Mantenimiento se entera de inmediato, sin depender del correo.
  const equipo = await prisma.user.findMany({
    where: {
      organizationId: punto.organizationId,
      active: true,
      role: { in: ["OWNER", "ADMIN", "SUPERVISOR"] },
    },
    select: { id: true },
  });
  const donde = [punto.asset ? `${punto.asset.code} ${punto.asset.name}` : null, punto.location?.name, punto.site?.name]
    .filter(Boolean).join(" · ");
  await Promise.all(
    equipo.map((u) =>
      notify({
        organizationId: punto.organizationId,
        userId: u.id,
        title:
          riesgo.nivel === "ALTO"
            ? `RIESGO · ${numero}: ${params.titulo.trim().slice(0, 50)}`
            : `Solicitud ${numero}: ${params.titulo.trim().slice(0, 60)}`,
        body:
          riesgo.nivel === "ALTO"
            ? `${riesgo.motivo}. Reportó ${params.nombre.trim()} · ${params.celular.trim()}${donde ? ` — ${donde}` : ""}`
            : `${params.nombre.trim()} · ${params.celular.trim()}${donde ? ` — ${donde}` : ""}`,
        link: `/requests/${solicitud.id}`,
        kind: riesgo.nivel === "ALTO" ? "CRITICAL" : "WARNING",
      }),
    ),
  );

  return { numero: solicitud.number, seguimiento };
}

/** El estado de una solicitud, para quien la levanto. Sin sesion. */
export async function seguimientoDe(tok: string) {
  const s = await prisma.workRequest.findUnique({
    where: { publicToken: tok },
    select: {
      number: true, title: true, description: true, status: true, createdAt: true,
      reviewedAt: true, reviewNotes: true, reporterNombre: true,
      organization: { select: { name: true, logoUrl: true } },
      site: { select: { name: true } },
      location: { select: { name: true } },
      asset: { select: { code: true, name: true } },
      workOrder: { select: { number: true, status: true, completedAt: true, dueDate: true } },
    },
  });
  return s;
}

/**
 * Recuperar el seguimiento con folio y celular.
 *
 * La liga se pierde en cuanto se cierra el navegador, y eso va a pasar. Se
 * pide el celular ademas del folio para que un folio adivinado no alcance.
 */
export async function recuperarSeguimiento(folio: string, celular: string) {
  const limpio = (t: string) => t.replace(/\D/g, "");
  const s = await prisma.workRequest.findFirst({
    where: { number: folio.trim().toUpperCase() },
    select: { publicToken: true, reporterCelular: true },
  });
  if (!s?.publicToken || !s.reporterCelular) return null;
  // Se comparan solo los digitos: nadie escribe el telefono igual dos veces.
  if (limpio(s.reporterCelular) !== limpio(celular)) return null;
  return s.publicToken;
}


// ═══════════════════════════════════════════════════════════════════════════
// "Mis reportes": el historial de quien reporta, sin cuenta.
//
// Quien reporta seguido acumula folios sueltos y ninguno le sirve para ver el
// panorama. Se identifica UNA vez —folio mas celular, o entrando por la liga
// de una solicitud suya, que ya prueba que es el— y el dispositivo lo recuerda
// noventa dias. Es reconocimiento, no cuenta: no hay contraseña que olvidar ni
// asiento de plan que consumir.
// ═══════════════════════════════════════════════════════════════════════════

const COOKIE_REPORTANTE = "mt_reportante";
const DIAS = 90;

function llave() {
  const valor = process.env.AUTH_SECRET;
  if (!valor) throw new Error("AUTH_SECRET no esta configurado");
  return new TextEncoder().encode(valor);
}

/** Solo digitos: nadie escribe su telefono igual dos veces. */
export const soloDigitos = (t: string) => t.replace(/\D/g, "");

export async function recordarReportante(celular: string) {
  const token = await new SignJWT({ cel: soloDigitos(celular) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DIAS}d`)
    .sign(llave());

  const jar = await cookies();
  jar.set(COOKIE_REPORTANTE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DIAS * 86_400,
  });
}

export async function reportanteActual(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_REPORTANTE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, llave());
    const cel = payload.cel;
    return typeof cel === "string" && cel.length >= 7 ? cel : null;
  } catch {
    return null;
  }
}

export async function olvidarReportante() {
  const jar = await cookies();
  jar.delete(COOKIE_REPORTANTE);
}

/**
 * Todas las solicitudes de un celular, agrupadas por empresa.
 *
 * Agrupar importa: alguien puede reportar en la plaza donde trabaja y en el
 * edificio donde vive, y mezclarlas confundiria mas de lo que ayuda.
 */
export async function misSolicitudes(celular: string) {
  const digitos = soloDigitos(celular);
  if (digitos.length < 7) return [];

  // El celular se guarda como lo escribieron, asi que se compara normalizado
  // en memoria. Con el volumen de un reportante son unas cuantas filas.
  const candidatas = await prisma.workRequest.findMany({
    where: { reporterCelular: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: {
      number: true, title: true, status: true, createdAt: true, publicToken: true,
      reporterCelular: true,
      organization: { select: { id: true, name: true } },
      site: { select: { name: true } },
      location: { select: { name: true } },
      asset: { select: { code: true, name: true } },
      workOrder: { select: { status: true, completedAt: true } },
    },
  });

  const mias = candidatas.filter((c) => soloDigitos(c.reporterCelular ?? "") === digitos);

  const porEmpresa = new Map<string, { empresa: string; solicitudes: typeof mias }>();
  for (const s of mias) {
    const previo = porEmpresa.get(s.organization.id);
    if (previo) previo.solicitudes.push(s);
    else porEmpresa.set(s.organization.id, { empresa: s.organization.name, solicitudes: [s] });
  }
  return [...porEmpresa.values()];
}
