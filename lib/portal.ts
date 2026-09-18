import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { nextRequestNumber } from "./numbering";
import { clasificar, construirRuta, guardarArchivo } from "./almacenamiento";
import { notify } from "./audit";
import { evaluarRiesgo } from "./riesgo";
import { estaFrenado, registrarIntento } from "./acceso";
import { imagenDeVerdad, telefonoDeFuera, textoDeFuera } from "./texto-publico";

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
    if (!l) throw new ErrorDePortal("La ubicación indicada no existe");
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
      mostrarEmpresa: true, mostrarPlanta: true, mostrarEquipo: true,
      organization: { select: { name: true, logoUrl: true, avisoPrivacidadUrl: true } },
      site: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      asset: { select: { id: true, code: true, name: true } },
    },
  });
  // La misma respuesta para un codigo inventado y para uno desactivado: quien
  // escanea no tiene por que distinguirlos, y distinguirlos sirve para tantear.
  if (!punto || !punto.activo) return null;
  return punto;
}

/**
 * Lo que se le ENSEÑA a quien escanea, que puede ser cualquiera.
 *
 * El punto conserva todo su contexto por dentro —la solicitud se cuelga del
 * equipo, del area y de la planta correctos— pero hacia afuera solo sale lo que
 * su configuracion permita. Por omision: el nombre del punto y la clave del
 * equipo, que es lo minimo para saber que se esta reportando.
 */
export function vistaPublicaDelPunto(punto: NonNullable<Awaited<ReturnType<typeof contextoDelPunto>>>) {
  /**
   * El nombre del PUNTO no se usa cuando hay equipo.
   *
   * Los puntos de un equipo se llaman como el equipo —«CMP-301 · Compresor de
   * tornillo Atlas Copco GA-75»— porque se generan solos al abrir su ficha. Ese
   * nombre es justo lo que no debe salir sin permiso: la clave basta para saber
   * que se esta reportando. El nombre escrito a mano solo manda en los puntos
   * de lugar, donde no hay equipo del cual heredar nada.
   */
  const referencia = punto.asset
    ? punto.mostrarEquipo
      ? `${punto.asset.code} · ${punto.asset.name}`
      : punto.asset.code
    : punto.nombre;

  const lugar = punto.mostrarPlanta
    ? [punto.location?.name, punto.site?.name].filter(Boolean).join(" — ")
    : "";

  return {
    punto: referencia,
    empresa: punto.mostrarEmpresa ? punto.organization.name : null,
    lugar: lugar || null,
    avisoPrivacidadUrl: punto.organization.avisoPrivacidadUrl,
  };
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
  /** De donde viene el envio. Sirve para frenar a quien insiste desde un aparato. */
  origen?: string | null;
}) {
  const punto = await contextoDelPunto(params.tokenPunto);
  // Mismo texto para un codigo inventado, uno vencido y uno desactivado.
  if (!punto) throw new ErrorDePortal("Este código ya no esta activo. Pida uno nuevo a mantenimiento.");

  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000);
  const recientes = await prisma.workRequest.count({
    where: { reportPointId: punto.id, createdAt: { gte: desde } },
  });
  if (recientes >= LIMITE_POR_PUNTO) {
    throw new ErrorDePortal(
      "Se recibieron demasiados reportes de este punto en los últimos minutos. Espere un momento antes de enviar otro.",
    );
  }

  /**
   * Y ademas por ORIGEN.
   *
   * El limite por punto protege la bandeja de ese punto, pero no de quien
   * recorre veinte codigos distintos desde el mismo aparato —o de un script que
   * los tiene todos—. Se cuentan los envios recientes de ese origen, sin
   * importar por que codigo entraron.
   */
  if (params.origen) {
    const clave = `portal-origen:${params.origen}`;
    const freno = await estaFrenado(clave);
    if (freno.frenado) {
      throw new ErrorDePortal(
        `Se recibieron demasiados envíos desde este dispositivo. Espere ${freno.minutos} minuto(s) antes de enviar otro.`,
      );
    }
    await registrarIntento({ email: clave, ip: params.origen, exito: false, motivo: "PORTAL_ENVIO" });
  }

  const numero = await nextRequestNumber(punto.organizationId);
  const seguimiento = token();

  // El riesgo se evalua en el acto y sin IA: un "huele a gas" no puede esperar
  // a que alguien abra la bandeja, ni el reportante a que responda un modelo.
  const riesgo = evaluarRiesgo(textoDeFuera(params.titulo, 140), textoDeFuera(params.descripcion, 1000));

  const solicitud = await prisma.workRequest.create({
    data: {
      organizationId: punto.organizationId,
      number: numero,
      // Lo que escribio alguien de fuera se limpia ANTES de guardarse: sin
      // caracteres invisibles y con su largo acotado.
      title: textoDeFuera(params.titulo, 140),
      description: textoDeFuera(params.descripcion, 1000) || null,
      // El lugar lo pone el QR, no quien reporta: por eso no hace falta que
      // sepa como se llama el equipo.
      assetId: punto.asset?.id ?? null,
      siteId: punto.site?.id ?? null,
      locationId: punto.location?.id ?? null,
      reportPointId: punto.id,
      reporterNombre: textoDeFuera(params.nombre, 120),
      reporterCelular: telefonoDeFuera(params.celular),
      reporterCorreo: textoDeFuera(params.correo, 160) || null,
      publicToken: seguimiento,
      riesgo: riesgo.nivel,
      riesgoMotivo: riesgo.motivo,
      // Un reporte con riesgo entra como critico: la prioridad la pone lo que
      // se describe, no lo que el reportante creyo que era grave.
      priority: riesgo.nivel === "ALTO" ? "CRITICAL" : "MEDIUM",
    },
    select: { id: true, number: true },
  });

  let fotoGuardada = false;
  if (params.foto) {
    try {
      const datos = Buffer.from(params.foto.base64, "base64");
      // El tipo lo declara el navegador y se puede mentir; los primeros bytes
      // no. Lo que no sea la imagen que dice ser, no entra al almacen.
      if (!imagenDeVerdad(datos, params.foto.tipo)) throw new ErrorDePortal("El archivo no es una imagen válida");
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
          note: `Foto tomada al reportar por ${textoDeFuera(params.nombre, 120)}`,
        },
      });
      fotoGuardada = true;
    } catch {
      // Si el almacen falla —o el archivo no era una imagen— la solicitud ya
      // quedo levantada: perder la foto es molesto, perder el reporte es peor.
      // Pero no se calla: la respuesta lo dice y la pantalla lo muestra.
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

  return { numero: solicitud.number, seguimiento, fotoGuardada: params.foto ? fotoGuardada : null };
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
/**
 * Recupera la liga de seguimiento con folio y celular.
 *
 * El folio NO identifica una solicitud: es unico por empresa, asi que cada
 * cuenta tiene su propio SS-000001. Y quien recupera no trae sesion ni empresa,
 * porque es alguien de piso sin cuenta. El celular es lo que discrimina.
 *
 * Por eso se traen TODAS las que comparten folio y se filtra por telefono. Un
 * findFirst tomaba la primera que apareciera —la de otra empresa— y devolvia
 * null aunque los datos fueran correctos; en el peor caso, con dos telefonos
 * iguales, habria entregado la liga de otra compania.
 *
 * Si aun asi quedan dos, se niega. Ante la duda no se entrega nada.
 */
/**
 * Recuperar pide folio Y celular. Sin freno, quien conozca un folio puede
 * probar numeros hasta dar con el del reportante: por eso pasa por el mismo
 * contador de intentos que el inicio de sesion (lib/acceso.ts).
 */
export async function recuperarSeguimiento(folio: string, celular: string) {
  const limpio = (t: string) => t.replace(/\D/g, "");
  const digitos = limpio(celular);
  if (!digitos) return null;

  // El freno va por folio, que es lo unico que el atacante ya tiene; lo que
  // estaria probando es el celular.
  const clave = `portal:${folio.trim().toUpperCase()}`;
  const freno = await estaFrenado(clave);
  if (freno.frenado) {
    throw new ErrorDePortal(
      `Demasiados intentos con ese folio. Vuelva a intentar en ${freno.minutos} minuto(s).`,
    );
  }

  const candidatas = await prisma.workRequest.findMany({
    where: { number: folio.trim().toUpperCase() },
    select: { publicToken: true, reporterCelular: true },
  });

  // Se comparan solo los digitos: nadie escribe el telefono igual dos veces.
  const suyas = candidatas.filter(
    (c) => c.publicToken && c.reporterCelular && limpio(c.reporterCelular) === digitos,
  );
  if (suyas.length !== 1) {
    await registrarIntento({ email: clave, exito: false, motivo: "PORTAL_FOLIO" });
    return null;
  }
  await registrarIntento({ email: clave, exito: true, motivo: "PORTAL_FOLIO" });
  return suyas[0].publicToken;
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
