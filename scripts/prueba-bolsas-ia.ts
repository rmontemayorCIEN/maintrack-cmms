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
    revisar("el plan trae cupo propio para el parte del día", cupo.operacionesBrief > 0, { brief: cupo.operacionesBrief, plan: cupo.operaciones });

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

    console.log("\nLo que tiene bolsa propia NO gasta la del plan\n");
    // El defecto que se arreglo: la ayuda se validaba aparte y ademas
    // descontaba del plan. Se gasta el parte del dia y el plan no se mueve.
    const antes = (await consumoIa(org.id)).operacionesDelPlan;
    await gastar("BRIEF", 30);
    await gastar("AYUDA", 10);
    const despues = await consumoIa(org.id);
    revisar("gastar 30 partes y 10 ayudas no mueve el consumo del plan",
      despues.operacionesDelPlan === antes, { antes, despues: despues.operacionesDelPlan });
    revisar("pero sí cuentan en el consumo total, que es lo que se le enseña",
      despues.operaciones === antes + 40, { total: despues.operaciones, esperado: antes + 40 });

    console.log("\nLa bolsa propia sí tiene fondo\n");
    await gastar("BRIEF", cupo.operacionesBrief); // pasa del cupo
    const agotado = await puedeUsarIa(conIa, "BRIEF");
    revisar("al pasarse del cupo, el parte del día se detiene", !agotado.permitido, agotado.permitido ? "" : agotado.motivoCorto);
    revisar("y lo dice sin dejar a nadie sin la información",
      !agotado.permitido && agotado.motivo.includes("sigue en el inicio"), agotado.permitido ? "" : agotado.motivo);

    console.log("\nQue nadie quede sin límite por olvido\n");
    for (const f of CON_BOLSA_PROPIA) {
      const enPlanes = (Object.keys(PLANES) as ClavePlan[]).every((p) => {
        const ia = PLANES[p].ia as unknown as Record<string, number>;
        const clave = f === "AYUDA" ? "operacionesAyuda" : "operacionesBrief";
        return typeof ia[clave] === "number" && ia[clave] > 0;
      });
      revisar(`«${FUNCIONES_IA[f].nombre}» tiene cupo en los dos planes`, enPlanes, f);
      revisar(`   y está incluida en los dos planes, no solo por complemento`,
        (Object.keys(PLANES) as ClavePlan[]).every((p) => PLANES[p].ia.funciones.includes(f)), f);
    }
    // Si se agrega una tercera con bolsa propia, esta prueba hay que ampliarla:
    // el mapeo de clave de arriba solo conoce estas dos.
    revisar("son exactamente las dos conocidas; si se agrega otra, hay que darle su cupo aquí",
      CON_BOLSA_PROPIA.length === 2, CON_BOLSA_PROPIA.join("+"));

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
