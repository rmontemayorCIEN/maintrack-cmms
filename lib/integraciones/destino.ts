/**
 * A dónde se permite mandar un webhook.
 *
 * Un webhook es una petición que MainTrack hace por encargo de un cliente. Si
 * se deja apuntar a cualquier lado, un cliente puede usar el servidor para
 * tocar direcciones internas de Google Cloud (el servidor de metadatos da
 * credenciales), la base de datos o la red privada. Por eso:
 *
 *  - Solo `https://`, con nombre de dominio, puerto estándar o alto.
 *  - Ni `localhost`, ni `.internal`, `.local`, ni direcciones IP escritas.
 *  - El nombre se resuelve y TODAS sus direcciones deben ser públicas: nada
 *    de 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 (metadatos), 100.64/10,
 *    0/8, multicast, ni sus equivalentes IPv6.
 *
 * Se revisa al guardar el webhook y otra vez antes de cada envío: un dominio
 * puede cambiar a qué dirección apunta después de darse de alta.
 *
 * Solo en desarrollo y pruebas, con `AVISOS_WEBHOOK_PERMITIR_LOCAL=1`, se
 * acepta http://127.0.0.1 para el receptor de prueba. En producción esa
 * variable se ignora.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class DestinoNoPermitido extends Error {}

function ipv4Privada(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function ipv6Privada(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::" || x === "::1") return true;
  if (x.startsWith("::ffff:")) return ipv4Privada(x.slice(7));
  return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
}

export function direccionPrivada(ip: string): boolean {
  return isIP(ip) === 6 ? ipv6Privada(ip) : ipv4Privada(ip);
}

const permitirLocal = () => process.env.NODE_ENV !== "production" && process.env.AVISOS_WEBHOOK_PERMITIR_LOCAL === "1";

/**
 * Valida la URL y devuelve su forma normalizada. Lanza `DestinoNoPermitido`
 * con un motivo que se le puede mostrar a quien la capturó.
 */
export async function validarDestino(texto: string, opciones: { permitirLocal?: boolean } = {}): Promise<string> {
  const local = opciones.permitirLocal ?? permitirLocal();
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    throw new DestinoNoPermitido("La dirección no es una URL válida.");
  }
  if (url.username || url.password) throw new DestinoNoPermitido("La URL no puede llevar usuario ni contraseña.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (local && url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost")) return url.toString();

  if (url.protocol !== "https:") throw new DestinoNoPermitido("Solo se permiten direcciones https://.");
  if (isIP(host)) throw new DestinoNoPermitido("Use un nombre de dominio, no una dirección IP.");
  if (host === "localhost" || /\.(local|internal|localhost|lan|home|corp)$/.test(host) || !host.includes(".")) {
    throw new DestinoNoPermitido("Ese dominio es interno: el webhook debe apuntar a una dirección pública.");
  }
  if (url.port && !["443", "8443"].includes(url.port) && Number(url.port) < 1024) {
    throw new DestinoNoPermitido("Use el puerto 443 u otro puerto alto.");
  }
  let direcciones: Array<{ address: string }>;
  try {
    direcciones = await lookup(host, { all: true });
  } catch {
    throw new DestinoNoPermitido("No se encontró ese dominio.");
  }
  if (!direcciones.length || direcciones.some((d) => direccionPrivada(d.address))) {
    throw new DestinoNoPermitido("Ese dominio apunta a una dirección privada o interna.");
  }
  return url.toString();
}

/** La URL con el camino oculto, para mostrarla en historiales. */
export function urlEnmascarada(texto: string): string {
  try {
    const u = new URL(texto);
    return `${u.protocol}//${u.host}${u.pathname.length > 1 ? "/…" : "/"}`;
  } catch {
    return "(dirección inválida)";
  }
}
