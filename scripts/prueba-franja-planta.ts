/**
 * La franja de la planta del inicio (lib/planta.ts).
 *
 * Lo que se cuida aqui son los defectos que NO se anuncian: que la franja
 * cuente distinto que la cifra de vencidas de arriba, que un equipo caido
 * desaparezca de la barra por redondeo, que se cuele informacion de otra
 * empresa, o que la vea un rol que no ve equipos.
 *
 * Llama a la MISMA funcion que la pantalla, no reproduce sus pasos.
 *
 *   npx tsx scripts/prueba-franja-planta.ts
 */
import { prisma } from "../lib/db";
import { barraDe, franjaDePlanta, SEGMENTOS } from "../lib/planta";
import { filtroDeVencidas } from "../lib/vencimiento";
import { inicioDe } from "../lib/inicio";
import { puedeVerRuta, type Rol } from "../lib/pantallas";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${detalle ? ` · ${detalle}` : ""}`);
  if (!bien) fallas++;
}

const AYER = new Date(Date.now() - 86_400_000);
const ZONA = "America/Monterrey";

async function empresa(sello: string) {
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: ZONA, diasHabiles: "1,2,3,4,5" },
  });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "S1", name: "Planta" } });
  return { org, site };
}

async function main() {
  const sello = `franja-${Date.now()}`;
  const creadas: string[] = [];

  try {
    // ── Una planta con dos areas y un equipo en cada estado ────────────────
    const { org: A, site } = await empresa(sello);
    creadas.push(A.id);
    const nave = await prisma.location.create({ data: { organizationId: A.id, siteId: site.id, code: "NAVE", name: "Nave" } });
    const patio = await prisma.location.create({ data: { organizationId: A.id, siteId: site.id, code: "PATIO", name: "Patio" } });

    const equipo = async (code: string, status: string, locationId: string) =>
      prisma.asset.create({ data: { organizationId: A.id, siteId: site.id, locationId, code, name: code, status } });

    const caido = await equipo("EQ-CAIDO", "DOWN", nave.id);
    await equipo("EQ-MEDIAS", "DEGRADED", nave.id);
    await equipo("EQ-BIEN", "OPERATIONAL", nave.id);
    await equipo("EQ-BAJA", "RETIRED", nave.id);
    const enPatio = await equipo("EQ-PATIO", "OPERATIONAL", patio.id);
    const suelto = await prisma.asset.create({
      data: { organizationId: A.id, siteId: site.id, code: "EQ-SUELTO", name: "Sin área", status: "OPERATIONAL" },
    });

    const ot = async (n: string, assetId: string | null, dueDate: Date | null, status = "OPEN") =>
      prisma.workOrder.create({
        data: { organizationId: A.id, number: n, title: n, maintenanceType: "CORRECTIVE", status, assetId, dueDate },
      });
    await ot(`${sello}-1`, caido.id, AYER);            // vencida, en la nave
    await ot(`${sello}-2`, caido.id, null);            // abierta sin fecha
    await ot(`${sello}-3`, enPatio.id, AYER);          // vencida, en el patio
    await ot(`${sello}-4`, null, AYER);                // vencida SIN equipo
    await ot(`${sello}-5`, enPatio.id, AYER, "CLOSED"); // cerrada: no cuenta

    await prisma.predictiveAlert.create({
      data: { organizationId: A.id, assetId: caido.id, severity: "WARNING", title: "Vibración", message: "x", status: "OPEN" },
    });
    await prisma.predictiveAlert.create({
      data: { organizationId: A.id, assetId: caido.id, severity: "WARNING", title: "Atendida", message: "x", status: "RESOLVED" },
    });

    // ── Otra empresa, con el mismo tipo de datos ──────────────────────────
    const { org: B, site: siteB } = await empresa(`${sello}-b`);
    creadas.push(B.id);
    const naveB = await prisma.location.create({ data: { organizationId: B.id, siteId: siteB.id, code: "NAVE", name: "Nave de la otra" } });
    const equipoB = await prisma.asset.create({
      data: { organizationId: B.id, siteId: siteB.id, locationId: naveB.id, code: "EQ-B", name: "De la otra", status: "DOWN" },
    });
    await prisma.workOrder.create({
      data: { organizationId: B.id, number: `${sello}-b1`, title: "De la otra", maintenanceType: "CORRECTIVE", status: "OPEN", assetId: equipoB.id, dueDate: AYER },
    });

    console.log("\nAgrupada por área\n");
    const f = await franjaDePlanta(A.id, new Date(), ZONA);
    if (!f) { revisar("la franja se arma", false, "devolvió nula"); throw new Error("sin franja"); }

    revisar("agrupa por área cuando no hay sistemas", f.agrupadoPor === "area", f.agrupadoPor);
    revisar("no cuenta los equipos dados de baja", f.equipos === 5, `${f.equipos} equipos vivos de 6 registrados`);
    revisar("dice cuántos equipos no tienen área", f.sinGrupo === 1, `${f.sinGrupo}`);
    revisar("no inventa un área para el equipo suelto", !f.filas.some((x) => x.id === suelto.id));

    const naveF = f.filas.find((x) => x.nombre === "Nave");
    const patioF = f.filas.find((x) => x.nombre === "Patio");
    revisar("la nave trae sus tres equipos vivos", naveF?.equipos === 3, `${naveF?.equipos}`);
    revisar("cuenta el caído y el degradado", naveF?.abajo === 1 && naveF?.aMedias === 1, `abajo ${naveF?.abajo}, a medias ${naveF?.aMedias}`);
    revisar("la nave queda DETENIDO", naveF?.estado === "DETENIDO", String(naveF?.estado));
    revisar("el patio queda COMPLETO", patioF?.estado === "COMPLETO", String(patioF?.estado));
    revisar("lo peor va primero", f.filas[0]?.nombre === "Nave", f.filas.map((x) => x.nombre).join(" → "));
    revisar("no cuenta la orden cerrada", patioF?.abiertas === 1, `${patioF?.abiertas} abiertas en el patio`);
    revisar("cuenta la alerta abierta y no la resuelta", naveF?.alertas === 1, `${naveF?.alertas}`);
    revisar("el enlace del área filtra de verdad", naveF?.enlace === `/assets?locationId=${nave.id}`, naveF?.enlace ?? "");

    // ── Que la franja cuadre con la cifra de arriba ───────────────────────
    const ahora = new Date();
    const totalVencidas = await prisma.workOrder.count({ where: { organizationId: A.id, ...filtroDeVencidas(ZONA, ahora) } });
    const sumadas = f.filas.reduce((s, x) => s + x.vencidas, 0) + f.vencidasSinEquipo;
    revisar("las vencidas de la franja suman lo mismo que la cifra del inicio",
      sumadas === totalVencidas, `franja ${sumadas} · inicio ${totalVencidas}`);
    revisar("la vencida sin equipo se dice aparte", f.vencidasSinEquipo === 1, `${f.vencidasSinEquipo}`);

    // ── Cada renglón dice siempre las dos cosas ───────────────────────────
    revisar("todo renglón dice cómo están sus equipos", f.filas.every((x) => x.comoEstan.length > 0));
    revisar("un área sana lo dice con palabras", patioF?.comoEstan === "Todo operando", patioF?.comoEstan ?? "");
    revisar("un área con problema los enumera los dos",
      naveF?.comoEstan === "1 fuera de servicio · 1 degradado", naveF?.comoEstan ?? "");
    revisar("los pendientes se dicen aunque haya algo peor",
      naveF?.pendientes === "1 vencida · 1 alerta", naveF?.pendientes ?? "");

    // ── Nada de la otra empresa se coló ───────────────────────────────────
    revisar("no aparece el área de la otra empresa", !f.filas.some((x) => x.nombre.includes("otra")));
    const fB = await franjaDePlanta(B.id, ahora, ZONA);
    revisar("la otra empresa ve solo lo suyo", fB?.equipos === 1 && fB.filas.length === 1, `${fB?.equipos} equipos`);

    // ── La barra: lo malo nunca desaparece ────────────────────────────────
    console.log("\nLa barra\n");
    const pocos = barraDe({ equipos: 3, abajo: 1, aMedias: 1, reserva: 0, operando: 1 });
    revisar("con pocos equipos hay un cuadro por equipo", pocos.length === 3, `${pocos.length}`);
    revisar("el cuadro del caído va primero", pocos[0] === "abajo", pocos.join(","));

    const muchos = barraDe({ equipos: 200, abajo: 1, aMedias: 0, reserva: 0, operando: 199 });
    revisar("con muchos equipos la barra se recorta a veinte", muchos.length === SEGMENTOS, `${muchos.length}`);
    revisar("un solo equipo caído entre doscientos NO desaparece",
      muchos.includes("abajo"), muchos.filter((x) => x === "abajo").length + " cuadros rojos");

    const todosBien = barraDe({ equipos: 50, abajo: 0, aMedias: 0, reserva: 0, operando: 50 });
    revisar("una planta entera no pinta nada de otro color",
      todosBien.every((x) => x === "operando") && todosBien.length === SEGMENTOS, `${todosBien.length} cuadros`);

    const vacio = barraDe({ equipos: 0, abajo: 0, aMedias: 0, reserva: 0, operando: 0 });
    revisar("sin equipos no hay barra", vacio.length === 0);

    // ── Agrupada por sistema, en cuanto existe uno ────────────────────────
    console.log("\nAgrupada por sistema\n");
    const sistema = await prisma.conjunto.create({ data: { organizationId: A.id, code: "LINEA-1", name: "Línea 1" } });
    await prisma.conjuntoAsset.create({ data: { organizationId: A.id, conjuntoId: sistema.id, assetId: caido.id } });
    await prisma.conjuntoAsset.create({ data: { organizationId: A.id, conjuntoId: sistema.id, assetId: enPatio.id } });

    const fs = await franjaDePlanta(A.id, ahora, ZONA);
    revisar("en cuanto hay un sistema, se agrupa por sistema", fs?.agrupadoPor === "sistema", fs?.agrupadoPor ?? "");
    revisar("el sistema cruza áreas", fs?.filas[0]?.equipos === 2, `${fs?.filas[0]?.equipos} equipos en Línea 1`);
    revisar("los equipos que no están en ningún sistema se cuentan aparte", fs?.sinGrupo === 3, `${fs?.sinGrupo}`);
    revisar("el enlace lleva al mapa del sistema",
      fs?.filas[0]?.enlace === `/conjuntos/${sistema.id}`, fs?.filas[0]?.enlace ?? "");

    // Un equipo en dos sistemas cuenta una sola vez: si no, el total de la
    // franja seria mayor que el numero de equipos de la planta.
    const otro = await prisma.conjunto.create({ data: { organizationId: A.id, code: "LINEA-2", name: "Línea 2" } });
    await prisma.conjuntoAsset.create({ data: { organizationId: A.id, conjuntoId: otro.id, assetId: caido.id } });
    const fs2 = await franjaDePlanta(A.id, ahora, ZONA);
    const contados = (fs2?.filas ?? []).reduce((s, x) => s + x.equipos, 0) + (fs2?.sinGrupo ?? 0);
    revisar("un equipo en dos sistemas no se cuenta dos veces",
      contados === fs2?.equipos, `sumados ${contados} · vivos ${fs2?.equipos}`);

    // ── Quién la ve ───────────────────────────────────────────────────────
    console.log("\nQuién la ve\n");
    const ROLES: Rol[] = ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER", "VIEWER"];
    for (const rol of ROLES) {
      const u = await prisma.user.create({
        data: { organizationId: A.id, email: `${rol.toLowerCase()}-${sello}@prueba.mx`, name: rol, role: rol, passwordHash: "x" },
      });
      const usuario = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { organization: true } });
      const inicio = await inicioDe(usuario as never);
      const debeVerla = puedeVerRuta(rol, "/assets");
      revisar(`${rol} ${debeVerla ? "ve" : "NO ve"} la franja`, Boolean(inicio.franja) === debeVerla);
    }

    // ── Sin nada que dibujar, no se dibuja ────────────────────────────────
    console.log("\nCuentas sin datos\n");
    const { org: C } = await empresa(`${sello}-c`);
    creadas.push(C.id);
    revisar("una cuenta recién abierta no muestra una franja vacía", (await franjaDePlanta(C.id, ahora, ZONA)) === null);
  } finally {
    for (const id of creadas) {
      await prisma.workOrder.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
  }

  console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
