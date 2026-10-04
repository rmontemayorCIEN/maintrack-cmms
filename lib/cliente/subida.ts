/**
 * Subir un archivo desde el navegador: preparar la foto, pedir permiso, subir
 * directo al almacén con progreso y confirmar. Una sola implementación para
 * las evidencias de una orden y las fotos de una solicitud.
 *
 * Solo navegador (usa canvas y XMLHttpRequest).
 */

export type Destino =
  | { workOrderId: string } | { assetId: string }
  | { workRequestId: string } | { partId: string }
  | { rondinParadaId: string }
  /// La publicacion oficial de una norma, su guia, el manual del proveedor.
  | { normaId: string };

/** Lo mismo que acepta el servidor (lib/almacenamiento.ts): aquí para avisar antes de intentar. */
const TIPOS = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/gif",
  "video/mp4", "video/quicktime", "video/webm", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/msword", "text/plain", "text/csv",
];
export const TAMANO_MAXIMO_MB = 200;
const MB = 1_048_576;

/** Por qué no se puede subir, o null si se puede. */
export function problemaDe(file: File): string | null {
  if (file.type && !TIPOS.includes(file.type)) return `No se admiten archivos de tipo ${file.type}.`;
  if (file.size > TAMANO_MAXIMO_MB * MB) return `Pesa ${(file.size / MB).toFixed(0)} MB; el máximo es ${TAMANO_MAXIMO_MB} MB.`;
  return null;
}

/** El mismo archivo elegido dos veces (nombre, tamaño y fecha). */
export const huella = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/**
 * Fotos del celular: se orientan como se tomaron y se reducen a 2000 px del
 * lado mayor en JPEG 85 %. Una foto de 6 MB queda en unos 500 KB, legible
 * para una placa o una fuga, y sube por datos móviles. Si el navegador no
 * puede procesarla (HEIC en algunos teléfonos), se sube tal cual.
 */
export async function prepararImagen(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < 400 * 1024) return file;
  try {
    const imagen = await createImageBitmap(file, { imageOrientation: "from-image" });
    const escala = Math.min(1, 2000 / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    lienzo.getContext("2d")!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    imagen.close();
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const nombre = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nombre, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Mensajes que la persona entiende: qué pasó y si puede reintentar. */
export class ErrorDeSubida extends Error {
  constructor(message: string, readonly reintentable: boolean) { super(message); }
}

export async function subirArchivo(destino: Destino, original: File, onProgreso: (pct: number) => void): Promise<{ id: string }> {
  const file = await prepararImagen(original);
  const base = { ...destino, name: file.name, mimeType: file.type || "application/octet-stream", size: file.size };
  const red = () => new ErrorDeSubida("Se perdió la conexión. El archivo no se guardó; intente de nuevo cuando tenga señal.", true);

  let permiso: Response;
  try {
    permiso = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(base) });
  } catch { throw red(); }
  const datos = await permiso.json().catch(() => ({}));
  if (!permiso.ok) throw new ErrorDeSubida(datos.error ?? "No fue posible preparar la subida.", permiso.status >= 500);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(datos.metodo, datos.url, true);
    xhr.setRequestHeader("Content-Type", base.mimeType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ErrorDeSubida("El almacén rechazó el archivo. Intente de nuevo.", true)));
    xhr.onerror = () => reject(red());
    xhr.send(file);
  });

  let alta: Response;
  try {
    alta = await fetch("/api/attachments", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, storagePath: datos.storagePath }) });
  } catch { throw red(); }
  const r = await alta.json().catch(() => ({}));
  if (!alta.ok) throw new ErrorDeSubida(r.error ?? "No fue posible registrar el archivo.", alta.status >= 500 || alta.status === 409);
  return { id: r.attachment?.id };
}
