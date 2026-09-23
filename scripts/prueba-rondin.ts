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
import { prisma } from "../lib/db";
import {
  identificarParada, pistasDelDictado, hayQuePreguntar, iniciarRondin,
  terminarRondin, rondinEnCurso,
} from "../lib/rondin";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function main() {
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

    console.log("\nCuándo se da por bueno y cuándo se pregunta\n");
    revisar("un QR no se pregunta", !hayQuePreguntar("QR"));
    revisar("lo que eligió la persona tampoco", !hayQuePreguntar("ELEGIDO"));
    // Lo dicho NO basta: la transcripcion se equivoca justo con numeros y
    // nombres propios, que es de lo que estan hechos los codigos de equipo.
    revisar("lo deducido de la voz SÍ se pregunta", hayQuePreguntar("DICHO"));
    revisar("solo el área también", hayQuePreguntar("AREA"));

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
    const conArea = await identificarParada(org.id, { dicho: "aquí en la bomba tres", locationId: linea2.id });
    revisar("dentro del área declarada, la misma frase resuelve sola",
      conArea.como === "DICHO" && conArea.assetId === bomba2.id,
      { como: conArea.como, correcta: conArea.assetId === bomba2.id });

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
  } finally {
    for (const id of creadas) {
      await prisma.rondinParada.deleteMany({ where: { organizationId: id } });
      await prisma.rondin.deleteMany({ where: { organizationId: id } });
      await prisma.reportPoint.deleteMany({ where: { organizationId: id } });
      await prisma.asset.deleteMany({ where: { organizationId: id } });
      await prisma.location.deleteMany({ where: { organizationId: id } });
      await prisma.site.deleteMany({ where: { organizationId: id } });
      await prisma.user.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
