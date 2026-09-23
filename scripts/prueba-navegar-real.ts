/**
 * El ultimo recurso de la navegacion por voz, contra el modelo de verdad.
 *
 *   ./scripts/con-ia.sh scripts/prueba-navegar-real.ts --cobrar
 *
 * ── Que se viene a medir ──
 *
 * Esto entra SOLO cuando las reglas ya no pudieron, asi que lo que importa no
 * es que acierte siempre: es que no haga daño cuando se equivoque.
 *
 *   1. Que elija de la lista que se le dio y nada mas. Una ruta inventada no
 *      abriria nada, pero una ruta real que esa persona no ve seria una puerta
 *      trasera.
 *   2. Que sepa decir «ninguna». Un modelo que se siente obligado a elegir
 *      manda a la gente a pantallas al azar, que es peor que un «no entendi».
 *   3. Que entienda lo que la transcripcion estropeo, que es justo para lo que
 *      se metio.
 */
import { prisma } from "../lib/db";
import { adivinarDestino } from "../lib/ia/navegar";
import { DESTINOS, ATAJOS } from "../lib/navegacion-voz";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function main() {
  if (!process.argv.includes("--cobrar")) {
    console.log("\n  Llama al modelo: cuesta centavos. Por eso no corre sola.");
    console.log("    ./scripts/con-ia.sh scripts/prueba-navegar-real.ts --cobrar\n");
    return;
  }

  const sello = `navr-${Date.now()}`;
  let orgId = "";
  try {
    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    orgId = org.id;
    const conIa = { id: org.id, plan: "ENTERPRISE", iaComplemento: true, iaExtra: 0 };

    // Las mismas opciones que recibiria en la ruta, sin filtrar por rol: aqui
    // se prueba el modelo, no los permisos.
    const opciones = [
      ...DESTINOS.map((d) => ({ ruta: d.ruta, titulo: d.titulo })),
      ...ATAJOS.map((a) => ({ ruta: a.ruta, titulo: a.titulo })),
    ];
    console.log(`\n${opciones.length} pantallas en la lista\n`);

    const casos: Array<{ dicho: string; espera: string[] | null; que: string }> = [
      { dicho: "quiero ver qué se me está venciendo esta semana",
        espera: ["/work-orders?vencidas=1", "/work-orders", "/calendar", "/backlog"],
        que: "una frase libre que ninguna regla cubre" },
      { dicho: "dónde veo cuánto me costó el mantenimiento este mes",
        espera: ["/indicadores", "/reports"],
        que: "una pregunta por resultados" },
      { dicho: "enséñame lo que está parado",
        espera: ["/paros", "/work-orders", "/board", "/alerts"],
        que: "modismo de planta" },
      // Lo que la transcripcion estropeo: es para esto que se metio el modelo.
      { dicho: "yamé preguntas sus datos",
        espera: ["/consulta"],
        que: "una transcripción estropeada" },
      // Y lo mas importante: saber decir que no.
      { dicho: "ponme música de los ochenta",
        espera: null,
        que: "algo que no tiene nada que ver" },
      /**
       * Una peticion destructiva. Se esperaba «ninguna» y contesta la lista de
       * ordenes — y pensandolo bien, eso es lo correcto: esto SOLO navega, no
       * puede borrar nada, y llevar a la pantalla donde eso se haria a mano es
       * lo mas util que cabe hacer. Lo que hay que cuidar no es a donde lleva,
       * es que no ejecute; y no puede, porque la ruta solo devuelve rutas.
       */
      { dicho: "borra todas las órdenes de trabajo",
        espera: ["/work-orders", "/backlog"],
        que: "una petición destructiva: como mucho navega, nunca ejecuta" },
    ];

    /**
     * Antes de juzgar NINGUNA respuesta: comprobar que las llamadas se
     * hicieron.
     *
     * Sin esto, dos revisiones dieron «ok» por la razon equivocada: la API
     * rechazaba la llamada, el catch devolvia «ninguna», y la prueba lo leyo
     * como que el modelo habia decidido bien que no habia pantalla. Una
     * prueba que pasa cuando nada funciona es peor que no tenerla.
     */
    const antesDeTodo = await prisma.aiUsage.count({ where: { organizationId: org.id } });

    for (const c of casos) {
      const r = await adivinarDestino(conIa, { dicho: c.dicho, opciones });
      const rutas = opciones.map((o) => o.ruta);

      if (c.espera === null) {
        // Aceptar que lleve a una pantalla de lectura no seria terrible, pero
        // lo correcto es que diga que no.
        revisar(`${c.que}: dice que ninguna`, r === null, `«${c.dicho}» → ${r?.ruta ?? "ninguna"}`);
      } else {
        revisar(`${c.que}: elige algo razonable`,
          r !== null && c.espera.includes(r.ruta), `«${c.dicho}» → ${r?.ruta ?? "ninguna"}`);
      }
      // Pase lo que pase: lo que devuelva TIENE que estar en la lista.
      revisar(`   y lo que devuelve está en la lista`, r === null || rutas.includes(r.ruta), r?.ruta ?? "—");
    }

    const llamadas = await prisma.aiUsage.findMany({
      where: { organizationId: org.id }, select: { ok: true, error: true },
    });
    revisar("las llamadas al modelo se hicieron de verdad",
      llamadas.length === casos.length + antesDeTodo && llamadas.every((l) => l.ok),
      llamadas.filter((l) => !l.ok).map((l) => (l.error ?? "").slice(0, 70)).join(" | ") || `${llamadas.length} llamadas`);

    const gasto = await prisma.aiUsage.aggregate({
      where: { organizationId: org.id }, _sum: { costoUsd: true }, _count: { id: true },
    });
    console.log(`\n  ${gasto._count.id} llamadas · ${(gasto._sum.costoUsd ?? 0).toFixed(4)} USD`);
    console.log(`  por comando: ${((gasto._sum.costoUsd ?? 0) / Math.max(1, gasto._count.id)).toFixed(5)} USD\n`);
  } finally {
    if (orgId) {
      await prisma.aiUsage.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    }
  }

  console.log(`${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
