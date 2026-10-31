// El segundo factor, en codigo propio y sin dependencias.
//
// TOTP del RFC 6238: el codigo de seis digitos que cambia cada treinta segundos
// en Google Authenticator, Authy, 1Password o el gestor que ya uses.
//
// POR QUE TOTP Y NO SMS. El SMS cuesta por mensaje, depende de que haya senal, y
// se roba con un cambio de SIM —que en Mexico no es teorico—. TOTP es gratis,
// funciona sin cobertura y el secreto nunca viaja: solo se comparten seis
// digitos que caducan en medio minuto.
//
// POR QUE ESCRITO A MANO. Son sesenta renglones de HMAC y base32, y `node:crypto`
// ya trae lo unico dificil. Meter una dependencia para esto es meter codigo de
// terceros justo en la puerta de entrada, con su cadena de actualizaciones. Y
// —esto es lo que lo hace defendible— el RFC publica vectores de prueba, asi que
// la implementacion se comprueba contra el estandar y no contra mi criterio.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/// Cuanto dura cada codigo. Treinta segundos es lo que esperan todas las apps.
export const PASO_SEGUNDOS = 30;

/// Cuantos digitos. Seis, como todo el mundo.
export const DIGITOS = 6;

/// Cuantos pasos de tolerancia hacia atras y hacia adelante.
///
/// Uno: treinta segundos de margen por cada lado. Cubre un reloj desfasado y al
/// usuario que teclea despacio, y no mas: cada paso extra alarga la ventana en
/// la que un codigo robado todavia sirve.
export const TOLERANCIA_PASOS = 1;

const ALFABETO32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Base32 sin relleno, que es lo que esperan las apps autenticadoras.
export function aBase32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let salida = "";

  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO32[(valor << (5 - bits)) & 31];
  return salida;
}

/// De base32 a bytes. Tolera espacios, minusculas y el relleno con "=" porque
/// la gente copia y pega la clave de donde sea.
export function deBase32(texto: string): Uint8Array | null {
  const limpio = texto.replace(/[\s=-]/g, "").toUpperCase();
  if (limpio.length === 0) return null;

  let bits = 0;
  let valor = 0;
  const salida: number[] = [];

  for (const c of limpio) {
    const i = ALFABETO32.indexOf(c);
    if (i === -1) return null;
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(salida);
}

/// Un secreto nuevo. Veinte bytes, que es lo que recomienda el RFC 4226 para
/// SHA-1 y lo que generan las apps.
export function secretoNuevo(): string {
  return aBase32(new Uint8Array(randomBytes(20)));
}

/// El codigo para un paso concreto del contador.
///
/// Es HOTP del RFC 4226 con el contador puesto en el tiempo. La "truncacion
/// dinamica" —tomar el offset del ultimo nibble— es del estandar y por eso se
/// ve arbitraria: no lo es, y cambiarla rompe la compatibilidad con todas las
/// apps.
export function codigoDelPaso(secreto: Uint8Array, paso: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));

  const hmac = createHmac("sha1", Buffer.from(secreto)).update(contador).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncado =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(truncado % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

export function pasoDe(momento: Date): number {
  return Math.floor(momento.getTime() / 1000 / PASO_SEGUNDOS);
}

/// Compara dos codigos en tiempo constante.
///
/// Con `===` el tiempo de respuesta depende de cuantos digitos coinciden, y eso
/// se puede medir. Con seis digitos el ataque es teorico, pero escribirlo bien
/// cuesta tres renglones y no escribirlo se convierte en costumbre.
function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export type Verificacion =
  | { ok: true; paso: number }
  | { ok: false };

/// Comprueba un codigo.
///
/// Devuelve EL PASO que coincidio, no solo si vale. Quien llama lo guarda y
/// rechaza el mismo paso la proxima vez: sin eso, un codigo visto por encima
/// del hombro sirve treinta segundos completos y se puede reusar.
export function verificarCodigo(
  secretoBase32: string,
  codigo: string,
  momento: Date = new Date(),
  ultimoPasoUsado?: number | null,
): Verificacion {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return { ok: false };

  const secreto = deBase32(secretoBase32);
  if (!secreto || secreto.length === 0) return { ok: false };

  const actual = pasoDe(momento);
  for (let d = -TOLERANCIA_PASOS; d <= TOLERANCIA_PASOS; d++) {
    const paso = actual + d;
    // Un paso ya usado NO se acepta aunque el codigo sea correcto: es el mismo
    // codigo otra vez.
    if (ultimoPasoUsado != null && paso <= ultimoPasoUsado) continue;
    if (iguales(codigoDelPaso(secreto, paso), limpio)) return { ok: true, paso };
  }
  return { ok: false };
}

/// La URI que leen las apps al escanear el QR.
///
/// El `issuer` sale dos veces —en la etiqueta y como parametro— porque las apps
/// no se ponen de acuerdo en cual leen, y sin el, el contador termina con seis
/// entradas llamadas igual y sin saber cual es cual.
export function uriDeEnrolamiento(args: {
  secreto: string;
  correo: string;
  emisor: string;
}): string {
  const emisor = encodeURIComponent(args.emisor.slice(0, 40));
  const cuenta = encodeURIComponent(args.correo);
  return (
    `otpauth://totp/${emisor}:${cuenta}` +
    `?secret=${args.secreto}&issuer=${emisor}` +
    `&algorithm=SHA1&digits=${DIGITOS}&period=${PASO_SEGUNDOS}`
  );
}

/// La clave escrita para teclearla a mano, en bloques de cuatro.
///
/// Para quien no puede escanear —una computadora de escritorio sin camara, que
/// en un equipo es lo normal—. Sin esto, ese usuario simplemente no puede
/// activar el segundo factor.
export function claveLegible(secreto: string): string {
  return (secreto.match(/.{1,4}/g) ?? []).join(" ");
}
