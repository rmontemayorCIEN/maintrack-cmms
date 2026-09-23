/**
 * Las bolsas de IA: lo que raciona el plan y lo que no.
 *
 * Dos funciones tienen bolsa propia —la ayuda y el parte del dia— y la razon
 * es la misma: se usan a diario, cuestan centavos, y dejarian de usarse si
 * compitieran con el trabajo. Lo que aqui se cuida son los dos defectos que
 * eso puede tener, y ninguno se anuncia:
 *
 * 1. Que la bolsa propia no exista de verdad: que la funcion se valide contra
 *    su cupo PERO ademas vaya gastando el del plan. Asi estaba la ayuda: no se
 *    la paraba la bolsa del plan, pero si se la iba comiendo.
 *
 * 2. Que alguien agregue una funcion a `CON_BOLSA_PROPIA` y se le olvide darle
 *    cupo o su caso en `puedeUsarIa`, y quede sin limite ninguno.
 *
 *   npx tsx scripts/prueba-bolsas-ia.ts
 */
import { prisma } from "../lib/db";
import { CON_BOLSA_PROPIA, FUNCIONES_IA, type ClaveFuncionIA } from "../lib/ia/funciones";
import { consumoIa, puedeUsarIa } from "../lib/ia/consumo";
import { iaDeLaOrganizacion, PLANES, type ClavePlan } from "../lib/planes";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

const periodo = () => new Date().toISOString().slice(0, 7);

async function main() {
  const sello = `bol-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(org.id);
    const conIa = { id: org.id, plan: "PROFESSIONAL", iaComplemento: false, iaExtra: 0 };

    const gastar = (funcion: ClaveFuncionIA, veces: number) =>
      prisma.aiUsage.createMany({
        data: Array.from({ length: veces }, () => ({
          organizationId: org.id, funcion, periodo: periodo(), ok: true, modelo: "prueba",
          operaciones: FUNCIONES_IA[funcion].operaciones,
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costoUsd: 0.01,
        })),
      });

    console.log("\nCada bolsa es suya\n");
    const cupo = iaDeLaOrganizacion(conIa);
    revisar("el plan trae cupo propio para el parte del día", cupo.bolsas.BRIEF > 0, { brief: cupo.bolsas.BRIEF, plan: cupo.operaciones });
    revisar("y para el dictado del técnico", cupo.bolsas.DICTADO > 0, { dictado: cupo.bolsas.DICTADO });

    // Se agota la bolsa DEL PLAN sin tocar las de aparte.
    await gastar("PROCEDIMIENTO", 10); // 2 operaciones cada uno = 20, justo el cupo
    const tras = await consumoIa(org.id);
    revisar("lo del plan se contabiliza contra el plan", tras.operacionesDelPlan === 20, { delPlan: tras.operacionesDelPlan });

    const diag = await puedeUsarIa(conIa, "DIAGNOSTICO");
    revisar("con el plan agotado, lo que sale del plan se detiene", !diag.permitido, diag.permitido ? "" : diag.motivoCorto);

    const brief = await puedeUsarIa(conIa, "BRIEF");
    revisar("pero el parte del día sigue disponible: su bolsa es otra", brief.permitido, brief.permitido ? `quedan ${brief.restantes}` : brief.motivo);
    const ayuda = await puedeUsarIa(conIa, "AYUDA");
    revisar("y la ayuda también", ayuda.permitido, ayuda.permitido ? `quedan ${ayuda.restantes}` : ayuda.motivo);
    // El dictado es el que mas importa aqui: si el tecnico no puede dictar
    // porque el jefe gasto la bolsa, se deja de capturar y se cae todo lo que
    // vive de esa captura.
    const dictado = await puedeUsarIa(conIa, "DICTADO");
    revisar("y el técnico puede dictar aunque el plan esté agotado",
      dictado.permitido, dictado.permitido ? `quedan ${dictado.restantes}` : dictado.motivo);

    console.log("\nLo que tiene bolsa propia NO gasta la del plan\n");
    // El defecto que se arreglo: la ayuda se validaba aparte y ademas
    // descontaba del plan. Se gasta el parte del dia y el plan no se mueve.
    const antes = (await consumoIa(org.id)).operacionesDelPlan;
    await gastar("BRIEF", 30);
    await gastar("AYUDA", 10);
    await gastar("DICTADO", 25);
    const despues = await consumoIa(org.id);
    revisar("gastar 30 partes, 10 ayudas y 25 dictados no mueve el consumo del plan",
      despues.operacionesDelPlan === antes, { antes, despues: despues.operacionesDelPlan });
    revisar("pero sí cuentan en el consumo total, que es lo que se le enseña",
      despues.operaciones === antes + 65, { total: despues.operaciones, esperado: antes + 65 });

    console.log("\nLa bolsa propia sí tiene fondo\n");
    await gastar("BRIEF", cupo.bolsas.BRIEF); // pasa del cupo
    const agotado = await puedeUsarIa(conIa, "BRIEF");
    revisar("al pasarse del cupo, el parte del día se detiene", !agotado.permitido, agotado.permitido ? "" : agotado.motivoCorto);
    revisar("y lo dice sin dejar a nadie sin la información",
      !agotado.permitido && agotado.motivo.includes("sigue en el inicio"), agotado.permitido ? "" : agotado.motivo);

    console.log("\nQue nadie quede sin límite por olvido\n");
    // Ya no hay mapeo de nombres que mantener: el cupo vive en `bolsas` y el
    // tipo obliga a darselo a cada funcion de CON_BOLSA_PROPIA. Esto recorre
    // la lista, asi que una cuarta bolsa se revisa sola.
    for (const f of CON_BOLSA_PROPIA) {
      const planes = Object.keys(PLANES) as ClavePlan[];
      revisar(`«${FUNCIONES_IA[f].nombre}» tiene cupo en los dos planes`,
        planes.every((p) => PLANES[p].ia.bolsas[f] > 0),
        planes.map((p) => `${p}:${PLANES[p].ia.bolsas[f]}`).join(" "));
      revisar(`   y está incluida en los dos planes, no solo por complemento`,
        planes.every((p) => PLANES[p].ia.funciones.includes(f)), f);
      // Una bolsa propia que el complemento ampliara dejaria de ser propia:
      // volveria a depender de lo que el cliente compre.
      revisar(`   y su cupo no lo mueve el complemento`,
        iaDeLaOrganizacion({ plan: "PROFESSIONAL", iaComplemento: true, iaExtra: 500 }).bolsas[f]
          === PLANES.PROFESSIONAL.ia.bolsas[f], f);
    }

    console.log("\nLo que NO debe pasar\n");
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(otra.id);
    const vecina = await puedeUsarIa({ id: otra.id, plan: "PROFESSIONAL", iaComplemento: false, iaExtra: 0 }, "BRIEF");
    revisar("lo que gastó una empresa no le quita el parte del día a la de al lado", vecina.permitido);
  } finally {
    for (const id of creadas) {
      await prisma.aiUsage.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
