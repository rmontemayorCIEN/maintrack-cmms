import webpush from "web-push";
import { prisma } from "./db";

/**
 * Envio de avisos al celular.
 *
 * El canal no decide QUE se avisa: eso ya lo decide `notify()` en lib/audit.ts,
 * que es por donde pasa todo lo que el sistema le quiere decir a alguien. Aqui
 * solo se entrega. Esa separacion es la que permite sumar WhatsApp despues sin
 * volver a tocar las siete pantallas que hoy notifican.
 *
 * Cuesta cero por mensaje: no hay proveedor de por medio, el navegador lo
 * entrega. Ese es el motivo de empezar por aqui y no por WhatsApp.
 */

/** Tope del mecanismo del navegador. Se recorta antes de llegar a el. */
const MAXIMO_BYTES = 3500;
/**
 * Un servicio de avisos lento no puede detener una operacion de negocio. Se
 * corta y la orden de trabajo se guarda igual.
 */
const ESPERA_MAXIMA_MS = 6000;

export type AvisoPush = {
  title: string;
  body?: string;
  /** A donde lleva al tocarlo. Ruta interna, no URL completa. */
  link?: string;
  /**
   * Agrupa avisos del mismo asunto: el segundo reemplaza al primero en vez de
   * apilarse. Conviene usar el folio —"OT-000095"— para que tres cambios en la
   * misma orden no dejen tres avisos.
   */
  tag?: string;
  /** Se queda en pantalla hasta que la persona lo toca. Solo para lo urgente. */
  importante?: boolean;
};

/**
 * Si el servidor tiene con que firmar los avisos.
 *
 * Sin llaves VAPID el envio no es que falle: es que no existe. Se comprueba
 * aparte para poder decirselo al administrador en la pantalla, en vez de que
 * active la funcion y no llegue nada sin explicacion.
 */
export function pushConfigurado(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** La llave publica que el navegador necesita para suscribirse. No es secreta. */
export function llavePublica(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let configurado = false;
function configurar() {
  if (configurado || !pushConfigurado()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:soporte@maintrack.mx",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configurado = true;
}

/** Recorta el texto sin partir una palabra a la mitad. */
function recortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo - 1);
  const espacio = corte.lastIndexOf(" ");
  return `${espacio > maximo * 0.6 ? corte.slice(0, espacio) : corte}…`;
}

function armarCuerpo(aviso: AvisoPush): string {
  const payload = {
    title: recortar(aviso.title, 120),
    body: aviso.body ? recortar(aviso.body, 300) : undefined,
    link: aviso.link ?? "/dashboard",
    tag: aviso.tag,
    importante: aviso.importante ?? false,
  };
  const texto = JSON.stringify(payload);
  if (texto.length <= MAXIMO_BYTES) return texto;
  // Un aviso gigante no se manda truncado a la fuerza: se manda el titulo y
  // que la persona abra la aplicacion.
  return JSON.stringify({ ...payload, body: undefined });
}

export type ResultadoEnvio = {
  entregados: number;
  dadasDeBaja: number;
  fallidos: number;
  /** Por que no se mando nada, cuando no se mando nada. */
  motivo?: "SIN_LLAVES" | "APAGADO" | "SIN_DISPOSITIVOS";
};

/**
 * Manda un aviso a todos los dispositivos de una persona.
 *
 * Nunca lanza excepcion: un fallo del canal no puede tumbar el cierre de una
 * orden de trabajo. Lo que sí hace es LIMPIAR: cuando el navegador contesta
 * que la suscripcion ya no existe —el usuario borro el icono, cambio de
 * telefono, reinstalo— se borra en ese momento.
 *
 * Esa limpieza es la parte importante. Sin ella el sistema queda mandando a
 * direcciones muertas y el tablero diria que la persona esta avisada cuando
 * hace meses que no recibe nada.
 */
export async function enviarPush(userId: string, aviso: AvisoPush): Promise<ResultadoEnvio> {
  const vacio: ResultadoEnvio = { entregados: 0, dadasDeBaja: 0, fallidos: 0 };
  if (!pushConfigurado()) return { ...vacio, motivo: "SIN_LLAVES" };

  try {
    configurar();

    // Una sola consulta resuelve las dos preguntas: si la organizacion tiene
    // los avisos encendidos y a que aparatos hay que mandar.
    const suscripciones = await prisma.pushSubscription.findMany({
      where: { userId, organization: { avisosPush: true } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });

    if (!suscripciones.length) {
      // Se distingue "la empresa lo tiene apagado" de "esta persona no ha
      // dado de alta ningun aparato": son dos problemas con dos soluciones
      // distintas, y confundirlos manda al administrador a buscar donde no es.
      const encendido = await prisma.pushSubscription.count({ where: { userId } });
      return { ...vacio, motivo: encendido ? "APAGADO" : "SIN_DISPOSITIVOS" };
    }

    const cuerpo = armarCuerpo(aviso);
    const resultados = await Promise.allSettled(
      suscripciones.map(async (s) => {
        const envio = webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          cuerpo,
          { TTL: 60 * 60 * 24 },
        );
        const corte = new Promise<never>((_, rechazar) =>
          setTimeout(() => rechazar(new Error("tiempo agotado")), ESPERA_MAXIMA_MS),
        );
        await Promise.race([envio, corte]);
        return s.id;
      }),
    );

    const entregadas: string[] = [];
    const muertas: string[] = [];
    const conFallo: string[] = [];

    resultados.forEach((r, i) => {
      const s = suscripciones[i];
      if (r.status === "fulfilled") {
        entregadas.push(s.id);
        return;
      }
      // 404 y 410 son la respuesta formal de "esta suscripcion ya no existe".
      // Cualquier otro codigo puede ser pasajero y no justifica dar de baja.
      const codigo = (r.reason as { statusCode?: number })?.statusCode;
      if (codigo === 404 || codigo === 410) muertas.push(s.id);
      else conFallo.push(s.id);
    });

    await Promise.all([
      entregadas.length
        ? prisma.pushSubscription.updateMany({
            where: { id: { in: entregadas } },
            data: { ultimoEnvioAt: new Date(), fallos: 0 },
          })
        : null,
      muertas.length
        ? prisma.pushSubscription.deleteMany({ where: { id: { in: muertas } } })
        : null,
      conFallo.length
        ? prisma.pushSubscription.updateMany({
            where: { id: { in: conFallo } },
            data: { fallos: { increment: 1 } },
          })
        : null,
    ]);

    return {
      entregados: entregadas.length,
      dadasDeBaja: muertas.length,
      fallidos: conFallo.length,
    };
  } catch (error) {
    console.error("[push]", error instanceof Error ? error.message : error);
    return { ...vacio, fallidos: 1 };
  }
}

/**
 * Nombre corto del aparato, deducido del identificador del navegador.
 *
 * En la lista de dispositivos "iPhone · instalada" contra "iPhone · Safari" es
 * justo el dato que resuelve el reporte mas comun —"no me llegan los avisos"—
 * sin tener que pedirle nada al usuario.
 */
export function nombrarDispositivo(userAgent: string | null | undefined, instalada?: boolean): string {
  const ua = userAgent ?? "";
  let aparato = "Dispositivo";
  if (/iPad/i.test(ua)) aparato = "iPad";
  else if (/iPhone/i.test(ua)) aparato = "iPhone";
  else if (/Android/i.test(ua)) aparato = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) aparato = "Mac";
  else if (/Windows/i.test(ua)) aparato = "Windows";

  if (instalada === true) return `${aparato} · instalada`;

  let navegador = "";
  // El orden importa: Chrome y Edge se anuncian como Safari, y Edge tambien
  // como Chrome. Se revisa del mas especifico al mas general.
  if (/Edg\//i.test(ua)) navegador = "Edge";
  else if (/OPR\//i.test(ua)) navegador = "Opera";
  else if (/Chrome\//i.test(ua)) navegador = "Chrome";
  else if (/Firefox\//i.test(ua)) navegador = "Firefox";
  else if (/Safari\//i.test(ua)) navegador = "Safari";

  return navegador ? `${aparato} · ${navegador}` : aparato;
}
