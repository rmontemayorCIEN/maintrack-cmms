/**
 * Un solo criterio para «alerta abierta» (lib/alertas.ts).
 *
 * El defecto que se cuida aqui no se anunciaba: el Inicio contaba las alertas
 * reconocidas y el parte del dia no, asi que con los mismos datos del mismo
 * dia cada pantalla daba un numero distinto. Ninguna se veia mal por separado.
 *
 * Por eso esto NO revisa el filtro: revisa que las cuatro lecturas den el
 * MISMO numero con los mismos datos. Un criterio se desincroniza justo cuando
 * alguien cambia una pantalla sin acordarse de las otras tres, y eso solo lo
 * atrapa compararlas entre si.
 *
 * Llama a las mismas funciones que las pantallas, no reproduce sus pasos.
 *
 *   npx tsx scripts/prueba-alertas-abiertas.ts
 */
import { prisma } from "../lib/db";
import { alertaAbierta, ESTADOS_ALERTA_ABIERTA, estaAbierta } from "../lib/alertas";
import { franjaDePlanta } from "../lib/planta";
import { guionDelDia } from "../lib/brief";
import { inicioDe } from "../lib/inicio";
import { resumenDemo } from "../lib/demo-comercial";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

const ZONA = "America/Monterrey";

async function main() {
  const sello = `alr-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: ZONA, diasHabiles: "1,2,3,4,5" },
    });
    creadas.push(org.id);
    const site = await prisma.site.create({ data: { organizationId: org.id, code: "S1", name: "Planta" } });
    // Con ubicacion a proposito: la franja agrupa por sistema o por area, y un
    // equipo sin ninguna de las dos se queda fuera de la barra.
    const nave = await prisma.location.create({ data: { organizationId: org.id, siteId: site.id, code: "NAVE", name: "Nave" } });
    const activo = await prisma.asset.create({
      data: { organizationId: org.id, siteId: site.id, locationId: nave.id, code: "EQ-1", name: "Compresor", status: "OPERATIONAL", criticality: "A" },
    });
    const director = await prisma.user.create({
      data: { organizationId: org.id, email: `dir-${sello}@t.mx`, name: "Directora", role: "OWNER", passwordHash: "x" },
    });

    const alerta = (status: string, title: string) =>
      prisma.predictiveAlert.create({
        data: { organizationId: org.id, assetId: activo.id, severity: "CRITICAL", status, title, message: "m" },
      });

    // ── Una de cada estado: dos abiertas y dos que ya se cerraron ─────────
    const sinReconocer = await alerta("OPEN", "Vibracion alta");
    const reconocida = await alerta("ACKNOWLEDGED", "Temperatura alta");
    const abiertas = new Set([sinReconocer.id, reconocida.id]);
    await alerta("RESOLVED", "Ya resuelta");
    await alerta("DISMISSED", "Descartada");

    const ahora = new Date();
    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: director.id }, include: { organization: true } });

    console.log("\nLas cuatro lecturas, con los mismos datos\n");

    const porFiltro = await prisma.predictiveAlert.count({ where: { organizationId: org.id, ...alertaAbierta() } });
    revisar("el criterio cuenta las dos abiertas y ninguna cerrada", porFiltro === 2, { abiertas: porFiltro });

    const guion = await guionDelDia(usuario as never, ahora);
    const puntoAlertas = guion.puntos.find((p) => p.clave === "alertas");
    const enBrief = puntoAlertas ? Number(puntoAlertas.texto.match(/(\d+)/)?.[1] ?? 0) : 0;

    // Al propietario las alertas criticas no le salen en un bloque propio:
    // se mezclan con las OT criticas. Por eso se buscan por id en todos los
    // bloques, que ademas aguanta que manana cambien de sitio.
    const inicio = await inicioDe(usuario as never, ahora);
    const enInicio = inicio.bloques.flatMap((b) => b.renglones).filter((r) => abiertas.has(r.id)).length;

    // `aMedias` de la franja es el estado del EQUIPO (DEGRADED); las alertas
    // van en su propio campo. No es lo mismo y no se cuentan juntas.
    const franja = await franjaDePlanta(org.id, ahora, ZONA);
    const enFranja = (franja?.filas ?? []).reduce((s, f) => s + f.alertas, 0);

    const enDemo = (await resumenDemo(org.id)).alertas;

    revisar("el parte del día dice lo mismo que el criterio", enBrief === porFiltro, { brief: enBrief, criterio: porFiltro });
    revisar("el Inicio dice lo mismo que el criterio", enInicio === porFiltro, { inicio: enInicio, criterio: porFiltro });
    revisar("el resumen de la demo dice lo mismo que el criterio", enDemo === porFiltro, { demo: enDemo, criterio: porFiltro });
    revisar("la franja dice lo mismo que el criterio", enFranja === porFiltro, { franja: enFranja, criterio: porFiltro });

    // ── La que se rompia: reconocer NO puede cambiar la cuenta ────────────
    console.log("\nReconocer una alerta no la saca de la cuenta\n");
    await prisma.predictiveAlert.update({ where: { id: reconocida.id }, data: { status: "OPEN" } });
    const guionB = await guionDelDia(usuario as never, ahora);
    const antesDeReconocer = Number(guionB.puntos.find((p) => p.clave === "alertas")?.texto.match(/(\d+)/)?.[1] ?? 0);
    await prisma.predictiveAlert.update({ where: { id: reconocida.id }, data: { status: "ACKNOWLEDGED" } });
    const guionC = await guionDelDia(usuario as never, ahora);
    const despues = Number(guionC.puntos.find((p) => p.clave === "alertas")?.texto.match(/(\d+)/)?.[1] ?? 0);
    revisar("el parte del día cuenta igual antes y después de reconocerla",
      antesDeReconocer === despues && despues === 2, { antes: antesDeReconocer, despues });

    console.log("\nLo que NO debe pasar\n");
    revisar("una cerrada no cuenta como abierta", !estaAbierta("RESOLVED") && !estaAbierta("DISMISSED") && !estaAbierta("CLOSED"));
    revisar("las dos abiertas sí", estaAbierta("OPEN") && estaAbierta("ACKNOWLEDGED"));
    revisar("el filtro no se puede modificar desde una consulta", alertaAbierta() !== alertaAbierta());
    revisar("el criterio son exactamente dos estados, para que no crezca sin querer",
      ESTADOS_ALERTA_ABIERTA.length === 2, [...ESTADOS_ALERTA_ABIERTA].join("+"));

    // ── Los dos que miran solo OPEN a proposito siguen haciendolo ─────────
    console.log("\nLos dos que preguntan otra cosa siguen preguntando otra cosa\n");
    const fuente = (ruta: string) => import("node:fs").then((fs) => fs.readFileSync(ruta, "utf8"));
    const detectores = await fuente("lib/avisos/detectores.ts");
    const escalamiento = await fuente("lib/avisos/escalamiento.ts");
    revisar("el aviso de alerta nueva no reavisa de una ya reconocida",
      /status: "OPEN"/.test(detectores) && !detectores.includes("alertaAbierta"));
    revisar("«alerta crítica sin reconocer» sigue mirando solo las sin reconocer",
      /severity: "CRITICAL", status: "OPEN"/.test(escalamiento) && !escalamiento.includes("alertaAbierta"));

    // ── Nada de esto se ve desde otra empresa ─────────────────────────────
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE", timezone: ZONA, diasHabiles: "1,2,3,4,5" },
    });
    creadas.push(otra.id);
    revisar("la empresa de al lado no ve ninguna",
      (await prisma.predictiveAlert.count({ where: { organizationId: otra.id, ...alertaAbierta() } })) === 0);
  } finally {
    for (const id of creadas) {
      await prisma.predictiveAlert.deleteMany({ where: { organizationId: id } });
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
