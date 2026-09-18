/**
 * Secretos de integraciones que hay que poder volver a usar.
 *
 * Una credencial de API solo se verifica, así que se guarda su huella y nada
 * más. El secreto de firma de un webhook, en cambio, hace falta en cada envío:
 * se guarda cifrado (AES-256-GCM) y nunca vuelve al navegador completo.
 *
 * La llave sale de `LLAVE_INTEGRACIONES` si existe (32 bytes en base64, en
 * Secret Manager). Si no, se deriva de `AUTH_SECRET` con HKDF y un contexto
 * propio: no es la misma llave que firma las sesiones. Cambiar cualquiera de
 * las dos obliga a regenerar los secretos de los webhooks.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

function llave(): Buffer {
  const propia = process.env.LLAVE_INTEGRACIONES;
  if (propia) {
    const b = Buffer.from(propia, "base64");
    if (b.length === 32) return b;
  }
  const base = process.env.AUTH_SECRET;
  if (!base) throw new Error("Falta AUTH_SECRET o LLAVE_INTEGRACIONES para cifrar secretos de integraciones");
  return Buffer.from(hkdfSync("sha256", base, "maintrack", "integraciones-v1", 32));
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), datos.toString("base64")].join(".");
}

export function descifrar(guardado: string): string {
  const [v, iv, etiqueta, datos] = guardado.split(".");
  if (v !== "v1") throw new Error("Formato de secreto desconocido");
  const d = createDecipheriv("aes-256-gcm", llave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(etiqueta, "base64"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64")), d.final()]).toString("utf8");
}

export const huella = (texto: string) => createHash("sha256").update(texto).digest("hex");

/** Comparación en tiempo constante de dos huellas hex. */
export function mismasHuellas(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export const aleatorio = (bytes = 24) => randomBytes(bytes).toString("base64url");
