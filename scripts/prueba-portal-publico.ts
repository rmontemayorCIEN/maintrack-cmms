/**
 * Bloque 3 — El QR público: lo mínimo a la vista, y con freno.
 *
 * Un código pegado en un pasillo lo escanea cualquiera. Esta prueba entra como
 * ese cualquiera —sin sesión, contra el servidor— y revisa dos cosas: que la
 * pantalla no anuncie de quién es la planta, y que enviar reportes en cadena
 * se corte solo.
 *
 *   npx tsx scripts/prueba-portal-publico.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { prisma } from "../lib/db";
import { seguroParaHoja, textoDeFuera, telefonoDeFuera, imagenDeVerdad } from "../lib/texto-publico";
import { toCsv } from "../lib/utils";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
      if (r.status < 500) return;
    } catch { /* todavia no levanta */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

/** Un PNG de un pixel, de verdad: sirve para probar que la foto sí se acepta. */
const PNG_REAL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3201";
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", "3201", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `qr-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: `Aceros Secretos de ${sello}`, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });

  try {
    console.log("\n0. Lo que se limpia antes de guardarse (sin servidor)");
    revisar("un texto con caracteres invisibles queda limpio",
      textoDeFuera("Fuga\u200b en la\u202e bomba", 140) === "Fuga en la bomba",
      textoDeFuera("Fuga\u200b en la\u202e bomba", 140));
    revisar("el teléfono se queda en dígitos", telefonoDeFuera("81-1234 5678 ext. 9") === "8112345678" + "9", telefonoDeFuera("81-1234 5678 ext. 9"));
    revisar("una fórmula de Excel deja de serlo al exportar",
      seguroParaHoja('=HYPERLINK("http://x","clic")').startsWith("'"),
      seguroParaHoja('=HYPERLINK("http://x","clic")'));
    revisar("y el CSV completo la lleva ya blindada",
      toCsv([{ Titulo: "=1+1", Nota: "normal" }]).includes("'=1+1"),
      toCsv([{ Titulo: "=1+1", Nota: "normal" }]));
    revisar("un texto normal NO se altera", seguroParaHoja("Bomba con ruido") === "Bomba con ruido");
    revisar("un archivo que dice ser JPEG pero no lo es, se rechaza",
      !imagenDeVerdad(Buffer.from("<html>no soy una foto</html>"), "image/jpeg"));
    revisar("un PNG de verdad se acepta", imagenDeVerdad(Buffer.from(PNG_REAL, "base64"), "image/png"));

    await esperarServidor(base, 240_000);

    const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "SIT-Q", name: "Planta Norte Confidencial" } });
    const ubicacion = await prisma.location.create({ data: { organizationId: org.id, siteId: sitio.id, code: "UBI-Q", name: "Nave de proceso 3" } });
    const activo = await prisma.asset.create({
      data: { organizationId: org.id, code: "BOM-900", name: "Bomba criogénica Sulzer", siteId: sitio.id, locationId: ubicacion.id },
    });
    const punto = await prisma.reportPoint.create({
      data: { organizationId: org.id, token: `tok-${sello}`, nombre: "Pasillo de bombas", assetId: activo.id, siteId: sitio.id, locationId: ubicacion.id },
    });
    const apagado = await prisma.reportPoint.create({
      data: { organizationId: org.id, token: `off-${sello}`, nombre: "Punto retirado", activo: false },
    });

    const pantalla = async (tok: string) => {
      const r = await fetch(`${base}/reportar/${tok}`, { signal: AbortSignal.timeout(120_000) });
      return { status: r.status, texto: await r.text() };
    };

    console.log("\n1. Por omisión el QR enseña lo mínimo");
    const p1 = await pantalla(punto.token);
    revisar("la pantalla abre sin sesión", p1.status === 200, p1.status);
    revisar("muestra la clave del equipo, para saber qué se reporta", p1.texto.includes("BOM-900"));
    // El nombre del punto tampoco sale cuando hay equipo: los puntos de equipo
    // se llaman COMO el equipo, y ahi se colaba el nombre completo.
    revisar("no usa el nombre del punto para colar el del equipo", !p1.texto.includes("Pasillo de bombas"));
    revisar("NO muestra el nombre de la empresa", !p1.texto.includes("Aceros Secretos"));
    revisar("NO muestra la planta", !p1.texto.includes("Planta Norte Confidencial"));
    revisar("NO muestra la ubicación interna", !p1.texto.includes("Nave de proceso 3"));
    revisar("NO muestra el nombre completo del equipo", !p1.texto.includes("Bomba criogénica Sulzer"));
    revisar("trae el aviso de datos y su enlace",
      /solo para dar seguimiento/i.test(p1.texto) && p1.texto.includes("Aviso de privacidad"));

    console.log("\n2. Y enseña más solo cuando alguien lo decide");
    await prisma.reportPoint.update({
      where: { id: punto.id },
      data: { mostrarEmpresa: true, mostrarPlanta: true, mostrarEquipo: true },
    });
    const p2 = await pantalla(punto.token);
    revisar("con las tres opciones encendidas sí aparecen",
      p2.texto.includes("Aceros Secretos") && p2.texto.includes("Planta Norte Confidencial") &&
      p2.texto.includes("Nave de proceso 3") && p2.texto.includes("Bomba criogénica Sulzer"));
    await prisma.reportPoint.update({
      where: { id: punto.id },
      data: { mostrarEmpresa: false, mostrarPlanta: false, mostrarEquipo: false },
    });

    // Un punto de LUGAR no tiene equipo del cual heredar: ahi si manda el nombre
    // que escribio mantenimiento, que es la referencia minima del area.
    const deLugar = await prisma.reportPoint.create({
      data: { organizationId: org.id, token: `lug-${sello}`, nombre: "Baño de planta baja" },
    });
    const pLugar = await pantalla(deLugar.token);
    revisar("un punto de lugar sí muestra su nombre, que es su única referencia",
      pLugar.texto.includes("Baño de planta baja"));

    console.log("\n3. Códigos inválidos y desactivados responden igual");
    const inventado = await pantalla(`no-existe-${sello}`);
    const desactivado = await pantalla(apagado.token);
    revisar("un código inventado: 404", inventado.status === 404, inventado.status);
    revisar("uno desactivado: el mismo 404, sin decir que existió", desactivado.status === 404, desactivado.status);

    const enviar = (tok: string, titulo: string, extra: Record<string, unknown> = {}) =>
      fetch(`${base}/api/publico`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.77" },
        body: JSON.stringify({
          accion: "REPORTAR", punto: tok, titulo, nombre: "Quien reporta", celular: "8112345678", ...extra,
        }),
        signal: AbortSignal.timeout(120_000),
      }).then(async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => ({})) as { error?: string } }));

    console.log("\n4. El reporte entra, limpio, y con su lugar guardado por dentro");
    const r1 = await enviar(punto.token, "=SUM(A1:A9) la bomba\u200b truena");
    revisar("el reporte se levanta", r1.status === 201, r1.cuerpo);
    const solicitud = await prisma.workRequest.findFirstOrThrow({
      where: { organizationId: org.id }, orderBy: { createdAt: "desc" },
    });
    revisar("el título quedó sin caracteres invisibles", !solicitud.title.includes("\u200b"), solicitud.title);
    revisar("y con el equipo, el área y la planta que puso el QR, aunque no se enseñen",
      solicitud.assetId === activo.id && solicitud.locationId === ubicacion.id && solicitud.siteId === sitio.id);
    const csv = toCsv([{ Folio: solicitud.number, Titulo: solicitud.title }]);
    revisar("al exportarlo, el título no puede ejecutarse en Excel", csv.includes("'=SUM"), csv.split("\n")[1]?.slice(0, 40));

    const rSucia = await enviar(punto.token, "Reporte con foto falsa", {
      foto: { base64: Buffer.from("<html>no soy una foto</html>".repeat(20)).toString("base64"), tipo: "image/png" },
    });
    const conFoto = await prisma.attachment.count({ where: { organizationId: org.id } });
    revisar("una «foto» que no es imagen no entra al almacén", conFoto === 0, { status: rSucia.status, adjuntos: conFoto });
    // Y no se pierde en silencio: la respuesta lo dice, y la pantalla lo muestra.
    revisar("quien reportó se entera de que su foto no se adjuntó",
      (rSucia.cuerpo as { fotoGuardada?: boolean | null }).fotoGuardada === false, rSucia.cuerpo);

    console.log("\n5. Enviar en cadena se corta solo");
    let ultimo = { status: 0, cuerpo: {} as { error?: string } };
    for (let i = 0; i < 12; i++) ultimo = await enviar(punto.token, `Reporte repetido ${i}`);
    revisar("tras varios envíos seguidos, el portal responde que espere",
      ultimo.status === 422 && /demasiad/i.test(ultimo.cuerpo.error ?? ""), ultimo);

    // Y el freno por ORIGEN: otro punto, mismo aparato.
    const otro = await prisma.reportPoint.create({
      data: { organizationId: org.id, token: `otro-${sello}`, nombre: "Otro pasillo" },
    });
    const rOtro = await enviar(otro.token, "Desde el mismo aparato, otro código");
    revisar("cambiar de código no evade el freno: el origen también cuenta",
      rOtro.status === 422 && /dispositivo/i.test(rOtro.cuerpo.error ?? ""), rOtro);

    console.log("\n6. El portal sigue sin abrir nada interno");
    const seguimiento = await fetch(`${base}/api/publico`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "RECUPERAR", folio: solicitud.number, celular: "0000000000" }),
      signal: AbortSignal.timeout(120_000),
    });
    revisar("con folio correcto y celular equivocado no entrega nada", seguimiento.status === 404, seguimiento.status);
  } finally {
    await prisma.accessAttempt.deleteMany({ where: { email: { contains: "portal-origen:203.0.113.77" } } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    if (servidor?.pid) {
      try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya termino */ }
    }
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
