/**
 * Avisos al celular.
 *
 * Lo que se prueba aqui es lo que falla en silencio: que el interruptor de la
 * empresa de verdad detenga los envios, que un fallo pasajero NO de de baja el
 * telefono de nadie, y que la campana siga guardando el aviso aunque el canal
 * se caiga. Ninguna de esas tres se nota mirando la pantalla.
 *
 *   npx tsx scripts/prueba-avisos-push.ts
 *
 * No necesita red ni llaves de produccion: genera un par propio.
 */
import webpush from "web-push";

// Las llaves se ponen ANTES de importar lib/push: el modulo pregunta por ellas
// al configurarse y con el .env vacio se quedaria en "no disponible".
const propias = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = propias.publicKey;
process.env.VAPID_PRIVATE_KEY = propias.privateKey;
process.env.VAPID_SUBJECT = "mailto:pruebas@maintrack.mx";

import { prisma } from "../lib/db";
import { enviarPush, nombrarDispositivo, pushConfigurado } from "../lib/push";
import { plataformaDe } from "../lib/avisos-instrucciones";
import { notify } from "../lib/audit";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

/** Una suscripcion con forma valida pero que no lleva a ningun lado. */
function suscripcionFalsa(sufijo: string) {
  return {
    endpoint: `https://ejemplo-que-no-existe-${sufijo}.invalid/push/${sufijo}`,
    p256dh: Buffer.from(propias.publicKey, "base64url").toString("base64url"),
    auth: Buffer.from("0123456789abcdef").toString("base64url"),
  };
}

async function main() {
  const sello = `prueba-push-${Date.now()}`;

  console.log("\nDeduccion del aparato a partir del navegador");
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
  const IPAD_MODERNO = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";

  revisar("iPhone en el navegador", nombrarDispositivo(IPHONE) === "iPhone · Safari", nombrarDispositivo(IPHONE));
  revisar("iPhone ya instalada", nombrarDispositivo(IPHONE, true) === "iPhone · instalada", nombrarDispositivo(IPHONE, true));
  revisar("Android con Chrome", nombrarDispositivo(ANDROID) === "Android · Chrome", nombrarDispositivo(ANDROID));
  // Edge se anuncia como Chrome y como Safari: si el orden de revision se
  // invierte, todas las computadoras con Windows salen como "Safari".
  revisar("Edge no se confunde con Chrome", nombrarDispositivo(EDGE) === "Windows · Edge", nombrarDispositivo(EDGE));

  console.log("\nEl iPad moderno se hace pasar por Mac");
  revisar("sin dedos es una Mac", plataformaDe(IPAD_MODERNO, 0) === "ESCRITORIO");
  // Es el caso que decide si al usuario se le pide instalar la aplicacion. Un
  // iPad tratado como Mac nunca ve las instrucciones y nunca recibe avisos.
  revisar("con varios dedos es un iPad", plataformaDe(IPAD_MODERNO, 5) === "IOS");
  revisar("iPhone se reconoce directo", plataformaDe(IPHONE, 5) === "IOS");
  revisar("Android se reconoce directo", plataformaDe(ANDROID, 5) === "ANDROID");

  console.log("\nEl servidor sabe si puede mandar");
  revisar("con llaves, disponible", pushConfigurado());

  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", avisosPush: false },
  });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Tecnico Prueba", role: "TECHNICIAN", passwordHash: "x" },
  });
  const otraOrg = await prisma.organization.create({
    data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", avisosPush: true },
  });
  const otroUser = await prisma.user.create({
    data: { organizationId: otraOrg.id, email: `${sello}-b@t.mx`, name: "Ajeno", role: "TECHNICIAN", passwordHash: "x" },
  });

  try {
    console.log("\nSin aparatos registrados");
    const sinNada = await enviarPush(user.id, { title: "Hola" });
    revisar("dice que no hay aparatos", sinNada.motivo === "SIN_DISPOSITIVOS", sinNada.motivo);
    revisar("no entrego nada", sinNada.entregados === 0);

    console.log("\nCon aparato pero la empresa lo tiene apagado");
    await prisma.pushSubscription.create({
      data: { organizationId: org.id, userId: user.id, dispositivo: "iPhone · instalada", ...suscripcionFalsa("uno") },
    });
    const apagado = await enviarPush(user.id, { title: "Hola" });
    // La distincion importa: "apagado" lo arregla el administrador en un
    // interruptor; "sin dispositivos" lo arregla el usuario en su telefono.
    // Confundirlos manda a la persona equivocada a buscar donde no es.
    revisar("distingue apagado de sin aparatos", apagado.motivo === "APAGADO", apagado.motivo);
    revisar("no intento entregar", apagado.entregados === 0);
    revisar("el aparato NO se borro al estar apagado",
      (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 1);

    console.log("\nSe enciende y ahora si intenta entregar");
    await prisma.organization.update({ where: { id: org.id }, data: { avisosPush: true } });
    const intento = await enviarPush(user.id, { title: "Hola", body: "Prueba" });
    revisar("ya no reporta apagado", intento.motivo === undefined, String(intento.motivo));
    // La direccion no existe, asi que falla. Lo que importa es COMO falla.
    revisar("cuenta el fallo", intento.fallidos === 1, JSON.stringify(intento));

    console.log("\nUn fallo pasajero no da de baja a nadie");
    // Este es el corazon de la prueba. Si un rato de mala red borrara las
    // suscripciones, la gente dejaria de recibir avisos sin enterarse y sin
    // haber hecho nada.
    revisar("la suscripcion sigue viva",
      (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 1);
    const tras = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: user.id } });
    revisar("quedo marcada con el fallo", tras.fallos >= 1, `fallos: ${tras.fallos}`);
    revisar("no dice que entrego", tras.ultimoEnvioAt === null);

    console.log("\nCada quien recibe lo suyo");
    await prisma.pushSubscription.create({
      data: { organizationId: otraOrg.id, userId: otroUser.id, dispositivo: "Android · Chrome", ...suscripcionFalsa("dos") },
    });
    const paraOtro = await enviarPush(otroUser.id, { title: "Ajeno" });
    revisar("el aviso del otro no toca este aparato", paraOtro.entregados === 0 && paraOtro.fallidos === 1);
    const mio = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: user.id } });
    revisar("mi contador no se movio por el envio ajeno", mio.fallos === tras.fallos, `${mio.fallos} vs ${tras.fallos}`);

    console.log("\nEl canal nunca se lleva el registro");
    // Si el aviso al celular falla, la notificacion de la campana tiene que
    // quedar igual: es el respaldo de que la persona se entere al entrar.
    await notify({
      organizationId: org.id, userId: user.id,
      title: "OT-000095 asignada", body: "Bomba de agua helada", link: "/work-orders", tag: "OT-000095",
    });
    const guardadas = await prisma.notification.findMany({ where: { userId: user.id } });
    revisar("la notificacion quedo guardada pese al fallo del canal", guardadas.length === 1,
      guardadas[0]?.title);
    revisar("conserva el enlace", guardadas[0]?.link === "/work-orders");

    console.log("\nUna direccion no puede estar en dos cuentas");
    // Si un tecnico presta el telefono y otro entra con su cuenta, el aparato
    // debe pasar de dueno. Duplicarlo mandaria ordenes ajenas al primero.
    const compartida = suscripcionFalsa("compartida");
    await prisma.pushSubscription.create({
      data: { organizationId: org.id, userId: user.id, dispositivo: "Prestado", ...compartida },
    });
    await prisma.pushSubscription.upsert({
      where: { endpoint: compartida.endpoint },
      create: { organizationId: otraOrg.id, userId: otroUser.id, dispositivo: "Prestado", ...compartida },
      update: { organizationId: otraOrg.id, userId: otroUser.id },
    });
    const cuantas = await prisma.pushSubscription.count({ where: { endpoint: compartida.endpoint } });
    revisar("sigue habiendo una sola", cuantas === 1, `hay ${cuantas}`);
    const duena = await prisma.pushSubscription.findFirstOrThrow({ where: { endpoint: compartida.endpoint } });
    revisar("cambio de dueno en vez de duplicarse", duena.userId === otroUser.id);
  } finally {
    await prisma.notification.deleteMany({ where: { organizationId: { in: [org.id, otraOrg.id] } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [org.id, otraOrg.id] } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.organization.delete({ where: { id: otraOrg.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
