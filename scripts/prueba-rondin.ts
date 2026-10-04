/**
 * El rondín: de qué equipo se está hablando, y cuándo NO se sabe.
 *
 * Lo que se cuida aquí, en orden de lo que más caro saldría:
 *
 *   1. Que no atribuya un hallazgo al equipo equivocado. Eso contamina el
 *      historial de ese equipo —MTBF, costo, Pareto— y no se nota nunca,
 *      porque el número sigue viéndose bien.
 *   2. Que cuando hay dudas NO elija por la persona. Quedarse con el primer
 *      candidato es una moneda al aire con el historial de por medio.
 *   3. Que un recorrido interrumpido se reanude en vez de duplicarse.
 *
 *   npx tsx scripts/prueba-rondin.ts
 */
import { type ChildProcess } from "node:child_process";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { apagarServidor, levantarServidor } from "./servidor-de-prueba";
import {
  identificarParada, pistasDelDictado, hayQuePreguntar, iniciarRondin,
  terminarRondin, rondinEnCurso, guardarHallazgos, resolverHallazgo, agregarParada,
} from "../lib/rondin";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

const PUERTO = 3219;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;

async function esperarServidor(limiteMs = 120_000) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) return;
    } catch { /* todavia no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) servidor = levantarServidor({ puerto: PUERTO });

  const sello = `ron-${Date.now()}`;
  const creadas: string[] = [];

  try {
    console.log("\nLo que de lo dictado puede ser un equipo\n");
    revisar("«aquí en la bomba tres» deja «bomba 3»",
      pistasDelDictado("Aquí en la bomba tres").join(" ") === "bomba 3",
      pistasDelDictado("Aquí en la bomba tres").join(" "));
    revisar("el relleno no estorba: «estoy en el compresor dos»",
      pistasDelDictado("estoy en el compresor dos").join(" ") === "compresor 2",
      pistasDelDictado("estoy en el compresor dos").join(" "));
    // La transcripcion a veces entrega «tres» y a veces «3». Las dos tienen
    // que sobrevivir, porque el numero es lo que distingue una bomba de otra.
    revisar("y también cuando el número llega en cifra: «bomba 3»",
      pistasDelDictado("aquí en la bomba 3").join(" ") === "bomba 3",
      pistasDelDictado("aquí en la bomba 3").join(" "));
    revisar("una frase sin equipo no deja pistas falsas",
      pistasDelDictado("aquí hay un charco").join(" ") === "charco",
      pistasDelDictado("aquí hay un charco").join(" "));

    console.log("\nCuándo se pregunta\n");
    // Se pregunta cuando NO hay equipo, no cuando el dato es menos firme:
    // confirmar algo que el sistema ya resolvio bien es como se ensenia a la
    // gente a tocar «si» sin leer.
    revisar("con equipo resuelto no se pregunta", !hayQuePreguntar({ assetId: "algo" }));
    revisar("sin equipo sí se pregunta", hayQuePreguntar({ assetId: null }));

    // ───────────────────────────────────────── Contra la base de verdad ────
    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(org.id);
    const sitio = await prisma.site.create({ data: { organizationId: org.id, name: "Planta", code: "P1" } });
    const linea2 = await prisma.location.create({ data: { organizationId: org.id, siteId: sitio.id, name: "Línea 2", code: "L2" } });
    const linea3 = await prisma.location.create({ data: { organizationId: org.id, siteId: sitio.id, name: "Línea 3", code: "L3" } });
    const jefe = await prisma.user.create({
      data: { organizationId: org.id, email: `s-${sello}@t.mx`, name: "Supervisor", role: "SUPERVISOR", passwordHash: "x" },
    });

    const bomba2 = await prisma.asset.create({
      data: { organizationId: org.id, siteId: sitio.id, locationId: linea2.id, code: "BOM-3", name: "Bomba 3", criticality: "B" },
    });
    // La MISMA «bomba 3» en otra línea: sin el área, lo dicho es ambiguo.
    const bomba3 = await prisma.asset.create({
      data: { organizationId: org.id, siteId: sitio.id, locationId: linea3.id, code: "BOM-3B", name: "Bomba 3", criticality: "B" },
    });
    const punto = await prisma.reportPoint.create({
      data: { organizationId: org.id, token: `tok-${sello}`, nombre: "Entrada línea 2", siteId: sitio.id,
        locationId: linea2.id, assetId: bomba2.id },
    });

    console.log("\nEl código QR manda\n");
    const porQr = await identificarParada(org.id, { tokenQr: punto.token });
    revisar("el QR resuelve el punto y su equipo",
      porQr.como === "QR" && porQr.assetId === bomba2.id && porQr.reportPointId === punto.id,
      { como: porQr.como, asset: porQr.assetId === bomba2.id });
    // Aunque lo dictado diga otra cosa, el codigo pegado en la pared gana: es
    // lo unico que no se equivoca.
    const qrGana = await identificarParada(org.id, { tokenQr: punto.token, dicho: "aquí en el compresor uno" });
    revisar("y le gana a lo que se dictó", qrGana.como === "QR" && qrGana.assetId === bomba2.id);

    console.log("\nEl área es lo que salva cuando no hay código\n");
    // Sin area: dos «bomba 3». No debe elegir.
    const ambiguo = await identificarParada(org.id, { dicho: "aquí en la bomba tres" });
    revisar("sin área, «bomba tres» es ambiguo y NO elige",
      ambiguo.assetId === null && ambiguo.candidatos.length === 2,
      { asset: ambiguo.assetId, candidatos: ambiguo.candidatos.length });
    revisar("   y ofrece los candidatos para que la persona decida",
      ambiguo.candidatos.map((c) => c.id).sort().join() === [bomba2.id, bomba3.id].sort().join());
    revisar("   diciendo por qué pregunta", ambiguo.explicacion.includes("2 equipos"), ambiguo.explicacion);

    // Con el area declarada al empezar, la misma frase se resuelve sola.
    // Como se habla de verdad en un rondin: el equipo Y el sintoma en la misma
    // frase. Exigir que todas las palabras coincidieran no identificaba nunca.
    const comoSeHabla = await identificarParada(org.id, {
      dicho: "aquí en la bomba tres se oye un rechinido feo y está goteando",
      locationId: linea2.id,
    });
    revisar("una frase real —equipo y síntoma juntos— sí identifica",
      comoSeHabla.assetId === bomba2.id, { asset: comoSeHabla.assetId === bomba2.id, como: comoSeHabla.como });
    // Y al reves: una frase que solo describe un problema no debe pegarle a
    // ningun equipo por casualidad.
    const soloSintoma = await identificarParada(org.id, {
      dicho: "se oye un rechinido feo y está goteando", locationId: linea2.id,
    });
    revisar("   y una que solo describe el problema, no inventa equipo",
      soloSintoma.assetId === null, { asset: soloSintoma.assetId });

    const conArea = await identificarParada(org.id, { dicho: "aquí en la bomba tres", locationId: linea2.id });
    revisar("dentro del área declarada, la misma frase resuelve sola",
      conArea.como === "DICHO" && conArea.assetId === bomba2.id,
      { como: conArea.como, correcta: conArea.assetId === bomba2.id });

    // Una palabra suelta no identifica, pero SI acota la pregunta: preguntar
    // con dos opciones se contesta de un vistazo; con catorce, no.
    const bombaSola = await identificarParada(org.id, { dicho: "hay una fuga abajo de la bomba" });
    revisar("una palabra suelta no decide, pero acota la pregunta",
      bombaSola.assetId === null && bombaSola.candidatos.length === 2,
      { asset: bombaSola.assetId, candidatos: bombaSola.candidatos.length });

    console.log("\nLo que la persona elige, manda\n");
    const elegido = await identificarParada(org.id, { assetIdElegido: bomba3.id, dicho: "aquí en la bomba tres", locationId: linea2.id });
    revisar("lo elegido gana sobre lo deducido", elegido.como === "ELEGIDO" && elegido.assetId === bomba3.id);
    revisar("   y toma la ubicación del equipo elegido, no la del área",
      elegido.locationId === linea3.id, { locationId: elegido.locationId === linea3.id });

    console.log("\nCuando no se sabe, se dice\n");
    const soloArea = await identificarParada(org.id, { dicho: "aquí hay un charco de aceite", locationId: linea2.id });
    revisar("un hallazgo sin equipo se queda con el área, no inventa equipo",
      soloArea.assetId === null && soloArea.como === "AREA" && soloArea.locationId === linea2.id,
      { como: soloArea.como, asset: soloArea.assetId });
    const nada = await identificarParada(org.id, {});
    revisar("sin nada, lo dice en vez de adivinar", nada.como === "NINGUNO" && nada.assetId === null);

    console.log("\nUn recorrido interrumpido se reanuda\n");
    const primero = await iniciarRondin(org.id, jefe.id, { siteId: sitio.id, locationId: linea2.id });
    revisar("el primero nace nuevo, con folio", !primero.reanudado && primero.rondin.numero.startsWith("RD-"), primero.rondin.numero);
    // Se cae la señal, se bloquea la pantalla, vuelve a entrar: es el mismo.
    const segundo = await iniciarRondin(org.id, jefe.id, { siteId: sitio.id });
    revisar("volver a entrar continúa el mismo, no abre otro",
      segundo.reanudado && segundo.rondin.id === primero.rondin.id, { reanudado: segundo.reanudado });
    const cuantos = await prisma.rondin.count({ where: { organizationId: org.id } });
    revisar("   y solo existe uno", cuantos === 1, { rondines: cuantos });

    console.log("\nAl cerrarlo\n");
    const vacio = await terminarRondin(org.id, primero.rondin.id);
    // Un recorrido sin una sola parada no es un recorrido: se cancela para que
    // no ensucie el historial con caminatas que nunca ocurrieron.
    revisar("uno sin paradas se cancela, no se guarda como hecho", vacio.ok && vacio.vacio, vacio);
    const estado = await prisma.rondin.findUnique({ where: { id: primero.rondin.id }, select: { estado: true } });
    revisar("   y queda como CANCELADO", estado?.estado === "CANCELADO", estado?.estado);
    const otraVez = await terminarRondin(org.id, primero.rondin.id);
    revisar("cerrar dos veces no pasa", !otraVez.ok, otraVez.ok ? "" : otraVez.motivo);
    revisar("y ya no hay ninguno en curso", (await rondinEnCurso(org.id, jefe.id)) === null);

    console.log("\nLo que NO debe pasar\n");
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(otra.id);
    // El token del QR de OTRA empresa no puede resolver aqui. El QR de un
    // pasillo lo lee cualquiera que pase.
    const ajeno = await identificarParada(otra.id, { tokenQr: punto.token });
    revisar("un QR de otra empresa no resuelve nada", ajeno.como === "NINGUNO" && ajeno.assetId === null, { como: ajeno.como });
    const equipoAjeno = await identificarParada(otra.id, { assetIdElegido: bomba2.id });
    revisar("ni se puede elegir un equipo de otra empresa", equipoAjeno.assetId === null, { asset: equipoAjeno.assetId });
    const dichoAjeno = await identificarParada(otra.id, { dicho: "aquí en la bomba tres" });
    revisar("ni encontrarlo por lo dictado", dichoAjeno.assetId === null && dichoAjeno.candidatos.length === 0);
    // ────────────────────────────────────── Por donde entra de verdad ────
    console.log("\nLas rutas: quién puede y de quién es\n");
    await esperarServidor();
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const credencial = (u: { id: string; email: string; name: string; role: string }, org: string) =>
      new SignJWT({ userId: u.id, organizationId: org, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);

    const mirona = await prisma.user.create({
      data: { organizationId: org.id, email: `v-${sello}@t.mx`, name: "Consulta", role: "VIEWER", passwordHash: "x" },
    });
    const deJefe = await credencial(jefe, org.id);
    const deMirona = await credencial(mirona, org.id);

    const pedir = async (jwt: string, metodo: string, ruta: string, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", Cookie: `mt_session=${jwt}` },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };

    const abierto = await pedir(deJefe, "POST", "/api/rondines", { locationId: linea2.id });
    revisar("un supervisor empieza un recorrido", abierto.status === 201, { status: abierto.status });
    const rid = (abierto.json.rondin as { id: string })?.id;

    // Consulta mira, no camina: anotar es del mismo permiso que ejecutar.
    const deLaMirona = await pedir(deMirona, "POST", `/api/rondines/${rid}/paradas`, { dicho: "algo" });
    revisar("una cuenta de solo lectura no anota paradas", deLaMirona.status === 403, { status: deLaMirona.status });

    const anotada = await pedir(deJefe, "POST", `/api/rondines/${rid}/paradas`,
      { dicho: "aquí en la bomba tres se oye raro" });
    revisar("con el área declarada, la parada sale identificada sin preguntar",
      anotada.status === 201 && anotada.json.hayQuePreguntar === false,
      { status: anotada.status, pregunta: anotada.json.hayQuePreguntar });

    const cerrado = await pedir(deJefe, "PATCH", `/api/rondines/${rid}`, {});
    revisar("se cierra", cerrado.status === 200, { status: cerrado.status });
    const otraVezCerrado = await pedir(deJefe, "POST", `/api/rondines/${rid}/paradas`, { dicho: "tarde" });
    revisar("y ya no acepta paradas: 409, no un 500", otraVezCerrado.status === 409, { status: otraVezCerrado.status });

    console.log("\nLas fotos de la parada\n");
    // Se vuelve a abrir uno: el anterior ya se cerro.
    const paraFotos = await pedir(deJefe, "POST", "/api/rondines", { locationId: linea2.id });
    const rid2 = (paraFotos.json.rondin as { id: string })?.id;
    const conFoto = await pedir(deJefe, "POST", `/api/rondines/${rid2}/paradas`, { dicho: "fuga en el piso" });
    const paradaId = (conFoto.json.parada as { id: string })?.id;
    revisar("hay una parada a la que colgarle fotos", !!paradaId);

    const permiso = await pedir(deJefe, "POST", "/api/attachments", {
      rondinParadaId: paradaId, name: "parada.jpg", mimeType: "image/jpeg", size: 120_000,
    });
    revisar("se puede pedir subir una foto a la parada", permiso.status === 200, { status: permiso.status });
    revisar("   y la ruta del archivo queda dentro de la empresa",
      String((permiso.json as { storagePath?: string }).storagePath ?? "").includes("rondines"),
      (permiso.json as { storagePath?: string }).storagePath);

    const sinPermiso = await pedir(deMirona, "POST", "/api/attachments", {
      rondinParadaId: paradaId, name: "x.jpg", mimeType: "image/jpeg", size: 1000,
    });
    revisar("una cuenta de solo lectura no le cuelga fotos", sinPermiso.status === 403, { status: sinPermiso.status });

    console.log("\nLo que la IA propone: nada se crea solo\n");
    // Se cierra el de las fotos ANTES de abrir este. `iniciarRondin` reanuda
    // el que esté abierto de esa persona —que es lo correcto—, así que sin
    // esto las paradas se numeraban seguidas del anterior y los hallazgos de
    // «parada 1» caían en una parada que no era. Mismo cuidado que pide la
    // regla de acotar siempre: aquí el estado compartido es el rondín abierto.
    await pedir(deJefe, "PATCH", `/api/rondines/${rid2}`, {});
    const paraIa = await iniciarRondin(org.id, jefe.id, { siteId: sitio.id, locationId: linea2.id });
    const p1 = await agregarParada(org.id, paraIa.rondin.id, { dicho: "aquí en la bomba tres se ve mojado el piso" });
    const p2 = await agregarParada(org.id, paraIa.rondin.id, { dicho: "el extintor está tapado con tarimas" });
    revisar("hay dos paradas para colgarles hallazgos", p1.ok && p2.ok);

    await guardarHallazgos(org.id, paraIa.rondin.id, [
      { parada: 1, categoria: "FUGA", titulo: "Posible fuga de aceite",
        baseVisual: "Mancha oscura de unos 40 cm bajo la brida derecha", detalle: null, certeza: "PROBABLE" },
      { parada: 2, categoria: "SEGURIDAD", titulo: "Extintor obstruido",
        baseVisual: "Dos tarimas de madera delante del extintor", detalle: "Despejar el acceso", certeza: "SEGURO" },
      // Uno que el modelo no pudo atribuir a ninguna parada: se guarda igual,
      // sin equipo, en vez de colgarselo a la primera que haya.
      { parada: 0, categoria: "ORDEN", titulo: "Desorden general",
        baseVisual: "Herramienta en el piso", detalle: null, certeza: "DUDOSO" },
    ]);

    const guardados = await prisma.rondinHallazgo.findMany({
      where: { organizationId: org.id, rondinId: paraIa.rondin.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, titulo: true, estado: true, assetId: true, rondinParadaId: true, categoria: true },
    });
    revisar("se guardaron los tres", guardados.length === 3, { n: guardados.length });
    revisar("todos nacen PROPUESTOS: nada entra al sistema sin que alguien lo vea",
      guardados.every((h) => h.estado === "PROPUESTO"));
    // El equipo se HEREDA de la parada; la IA no lo decide.
    const deLaUno = guardados.find((h) => h.titulo.includes("fuga"));
    revisar("el equipo se hereda de la parada, no lo decide la IA",
      deLaUno?.assetId === bomba2.id, { heredado: deLaUno?.assetId === bomba2.id });
    const huerfano = guardados.find((h) => h.titulo.includes("Desorden"));
    revisar("el que no se pudo atribuir queda sin parada y sin equipo",
      huerfano?.rondinParadaId === null && huerfano?.assetId === null);

    console.log("\nAceptar levanta una solicitud; descartar no crea nada\n");
    const antesSol = await prisma.workRequest.count({ where: { organizationId: org.id } });
    const aceptado = await resolverHallazgo(org.id, deLaUno!.id, jefe.id, "ACEPTADO");
    revisar("aceptar levanta una solicitud", aceptado.ok && !!aceptado.solicitud, aceptado.ok ? aceptado.solicitud?.numero : "");
    const sol = await prisma.workRequest.findFirst({
      where: { organizationId: org.id, id: aceptado.ok ? aceptado.solicitud!.id : "" },
      select: { title: true, description: true, priority: true, assetId: true },
    });
    // Lo que se VE viaja con la solicitud: quien la reciba tiene que poder ir
    // a la foto y contradecirla, no creerle a ciegas.
    revisar("la solicitud lleva en qué se basó, no solo la conclusión",
      (sol?.description ?? "").includes("Mancha oscura"), (sol?.description ?? "").slice(0, 60));
    revisar("   y de qué recorrido salió", (sol?.description ?? "").includes("RD-"));
    revisar("   y el equipo de la parada", sol?.assetId === bomba2.id);

    const seguridad = guardados.find((h) => h.categoria === "SEGURIDAD");
    const aceptado2 = await resolverHallazgo(org.id, seguridad!.id, jefe.id, "ACEPTADO");
    const sol2 = await prisma.workRequest.findFirst({
      where: { id: aceptado2.ok ? aceptado2.solicitud!.id : "" }, select: { priority: true },
    });
    // Lo de seguridad no espera a que alguien lo acomode en su cola.
    revisar("un hallazgo de seguridad entra con prioridad alta", sol2?.priority === "HIGH", sol2?.priority);

    const descartado = await resolverHallazgo(org.id, huerfano!.id, jefe.id, "DESCARTADO");
    revisar("descartar no crea nada", descartado.ok && descartado.solicitud === null);
    const ahoraSol = await prisma.workRequest.count({ where: { organizationId: org.id } });
    revisar("   y solo se crearon las dos aceptadas", ahoraSol === antesSol + 2, { antes: antesSol, ahora: ahoraSol });

    const yaResuelto = await resolverHallazgo(org.id, deLaUno!.id, jefe.id, "ACEPTADO");
    revisar("resolver dos veces no duplica la solicitud", !yaResuelto.ok, yaResuelto.ok ? "" : yaResuelto.motivo);

    console.log("\nVolver a revisar respeta lo que una persona ya decidió\n");
    await guardarHallazgos(org.id, paraIa.rondin.id, [
      { parada: 1, categoria: "DETERIORO", titulo: "Pintura descarapelada",
        baseVisual: "Óxido en la base", detalle: null, certeza: "DUDOSO" },
    ]);
    const tras = await prisma.rondinHallazgo.findMany({
      where: { organizationId: org.id, rondinId: paraIa.rondin.id },
      select: { titulo: true, estado: true },
    });
    // Lo resuelto es una decision de una persona: no se borra por volver a
    // preguntarle a la maquina.
    revisar("lo aceptado y lo descartado siguen ahí",
      tras.filter((h) => h.estado !== "PROPUESTO").length === 3, tras.map((h) => `${h.estado}`).join(" "));
    revisar("y lo propuesto anterior se reemplazó, no se acumuló",
      tras.filter((h) => h.estado === "PROPUESTO").length === 1,
      tras.filter((h) => h.estado === "PROPUESTO").map((h) => h.titulo).join(" | "));

    console.log("\nNo se cruza con la empresa de al lado\n");
    const otraOrg = await prisma.organization.create({
      data: { name: `${sello}-c`, slug: `${sello}-c`, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(otraOrg.id);
    const vecino = await prisma.user.create({
      data: { organizationId: otraOrg.id, email: `x-${sello}@t.mx`, name: "Vecino", role: "ADMIN", passwordHash: "x" },
    });
    const deVecino = await credencial(vecino, otraOrg.id);
    const espiado = await pedir(deVecino, "GET", `/api/rondines/${rid}`);
    revisar("el recorrido de otra empresa no se ve", espiado.status === 404, { status: espiado.status });
    const metido = await pedir(deVecino, "POST", `/api/rondines/${rid}/paradas`, { dicho: "me colé" });
    revisar("ni se le anotan paradas", metido.status === 409, { status: metido.status });
    const areaAjena = await pedir(deVecino, "POST", "/api/rondines", { locationId: linea2.id });
    revisar("ni se empieza un recorrido en un área ajena", areaAjena.status === 404, { status: areaAjena.status });
    const hallazgoAjeno = await resolverHallazgo(otraOrg.id, deLaUno!.id, vecino.id, "ACEPTADO");
    revisar("no se resuelve un hallazgo de otra empresa", !hallazgoAjeno.ok, hallazgoAjeno.ok ? "" : hallazgoAjeno.motivo);

    const fotoAjena = await pedir(deVecino, "POST", "/api/attachments", {
      rondinParadaId: paradaId, name: "colada.jpg", mimeType: "image/jpeg", size: 1000,
    });
    // 404 y no 403: al de fuera no se le confirma que esa parada exista.
    revisar("ni se le cuelgan fotos a la parada de otra empresa", fotoAjena.status === 404, { status: fotoAjena.status });
  } finally {
    for (const id of creadas) {
      await prisma.rondinHallazgo.deleteMany({ where: { organizationId: id } });
      await prisma.workRequest.deleteMany({ where: { organizationId: id } });
      await prisma.rondinParada.deleteMany({ where: { organizationId: id } });
      await prisma.rondin.deleteMany({ where: { organizationId: id } });
      await prisma.reportPoint.deleteMany({ where: { organizationId: id } });
      await prisma.asset.deleteMany({ where: { organizationId: id } });
      await prisma.location.deleteMany({ where: { organizationId: id } });
      await prisma.site.deleteMany({ where: { organizationId: id } });
      await prisma.user.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await apagarServidor(servidor, PUERTO);
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
