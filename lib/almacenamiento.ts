import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";

/**
 * Almacen de archivos.
 *
 * En produccion usa Google Cloud Storage: el navegador sube DIRECTO al bucket
 * con una URL firmada, sin pasar por Cloud Run. Eso evita el limite de tamaño
 * de peticion y permite videos de cientos de megas.
 *
 * En desarrollo escribe en disco, para poder probar el flujo completo sin
 * credenciales de Google. La interfaz es la misma en ambos casos.
 *
 * Los objetos NUNCA son publicos: cada descarga se firma al momento y caduca.
 */

const BUCKET = process.env.GCS_BUCKET;
export const usaGCS = Boolean(BUCKET);

const DIR_LOCAL = path.join(process.cwd(), ".almacen");

/** Minutos de vida de un enlace de descarga. Corto a proposito. */
const VIGENCIA_LECTURA = 15;
const VIGENCIA_SUBIDA = 10;

export const TIPOS_PERMITIDOS = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/msword",
  "text/plain", "text/csv",
];

export const TAMANO_MAXIMO_MB = 200;

export function clasificar(mimeType: string): "PHOTO" | "VIDEO" | "DOCUMENT" {
  if (mimeType.startsWith("image/")) return "PHOTO";
  if (mimeType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

/** Ruta dentro del almacen. El prefijo por organizacion aisla a cada cliente. */
export function construirRuta(orgId: string, contexto: string, nombre: string) {
  const extension = path.extname(nombre).toLowerCase().slice(0, 10);
  return `org-${orgId}/${contexto}/${randomUUID()}${extension}`;
}

async function bucket() {
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(BUCKET!);
}

/**
 * Destino de subida. En GCS es una URL firmada contra la que el navegador hace
 * PUT; en desarrollo, un endpoint propio que escribe en disco.
 */
export async function urlDeSubida(rutaAlmacen: string, mimeType: string) {
  if (!usaGCS) {
    return { url: `/api/attachments/local/${encodeURIComponent(rutaAlmacen)}`, metodo: "PUT" as const };
  }
  const [url] = await (await bucket())
    .file(rutaAlmacen)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + VIGENCIA_SUBIDA * 60_000,
      contentType: mimeType,
    });
  return { url, metodo: "PUT" as const };
}

/** Enlace de descarga temporal. */
export async function urlDeLectura(rutaAlmacen: string, nombreDescarga?: string) {
  if (!usaGCS) {
    return `/api/attachments/local/${encodeURIComponent(rutaAlmacen)}`;
  }
  const [url] = await (await bucket())
    .file(rutaAlmacen)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + VIGENCIA_LECTURA * 60_000,
      ...(nombreDescarga
        ? { responseDisposition: `inline; filename="${nombreDescarga.replace(/"/g, "")}"` }
        : {}),
    });
  return url;
}

export async function borrarArchivo(rutaAlmacen: string) {
  try {
    if (!usaGCS) {
      await fs.unlink(path.join(DIR_LOCAL, rutaAlmacen));
      return;
    }
    await (await bucket()).file(rutaAlmacen).delete({ ignoreNotFound: true });
  } catch {
    // Que falle el borrado fisico no debe impedir quitar el registro: quedaria
    // un adjunto fantasma visible en la interfaz, que es peor.
  }
}

/** Confirma que el archivo llego realmente al almacen, y con que tamaño. */
export async function verificarSubida(rutaAlmacen: string): Promise<number | null> {
  try {
    if (!usaGCS) {
      const stat = await fs.stat(path.join(DIR_LOCAL, rutaAlmacen));
      return stat.size;
    }
    const [metadata] = await (await bucket()).file(rutaAlmacen).getMetadata();
    return Number(metadata.size ?? 0);
  } catch {
    return null;
  }
}

/**
 * Guarda un archivo desde el servidor, sin URL firmada.
 *
 * Para lo chico y de larga vida —un logotipo— la subida directa del navegador
 * estorba: la URL de lectura firmada caduca en quince minutos y un logo tiene
 * que verse siempre. Estos objetos se sirven despues por una ruta propia, con
 * la sesion del usuario de por medio.
 */
export async function guardarArchivo(rutaAlmacen: string, datos: Buffer, mimeType: string) {
  if (!usaGCS) {
    await guardarLocal(rutaAlmacen, datos);
    return;
  }
  await (await bucket()).file(rutaAlmacen).save(datos, { contentType: mimeType, resumable: false });
}

/** Lee un archivo del almacen, sea GCS o disco. */
export async function leerArchivo(rutaAlmacen: string): Promise<Buffer> {
  if (!usaGCS) return leerLocal(rutaAlmacen);
  const [datos] = await (await bucket()).file(rutaAlmacen).download();
  return datos;
}

// ─────────────────────────────── Respaldo local (solo desarrollo) ───────────

export async function guardarLocal(rutaAlmacen: string, datos: Buffer) {
  const destino = path.join(DIR_LOCAL, rutaAlmacen);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, datos);
}

export async function leerLocal(rutaAlmacen: string) {
  return fs.readFile(path.join(DIR_LOCAL, rutaAlmacen));
}

/** Consumo total de una organizacion, en bytes. */
export async function espacioUsado(prismaAttachment: { aggregate: Function }, orgId: string) {
  const r = await prismaAttachment.aggregate({
    where: { organizationId: orgId },
    _sum: { size: true },
  });
  return Number(r._sum?.size ?? 0);
}
