/**
 * El contexto del negocio que reciben los prompts.
 *
 * Lo que se prueba es lo que falla en silencio: que el contexto LLEGUE a la
 * IA. Si no llega, ninguna funcion se rompe —el modelo simplemente responde
 * peor— y eso es indistinguible de que el modelo tuvo un mal dia.
 *
 *   npx tsx scripts/prueba-contexto-negocio.ts
 */
import { prisma } from "../lib/db";
import {
  contextoDeLaEmpresa, contestadas, contextoEnvejecido, ejemploDe,
  PREGUNTAS, LARGO_MAXIMO,
} from "../lib/contexto-negocio";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  console.log("\nSin nada capturado no se manda un bloque vacío");
  // Un objeto lleno de nulos gasta contexto y le sugiere al modelo que hay
  // informacion donde no la hay.
  revisar("una organización en blanco no aporta contexto",
    contextoDeLaEmpresa({}) === null);

  console.log("\nCon solo el tipo de instalación ya hay algo que decir");
  const soloTipo = contextoDeLaEmpresa({ tipoInstalacion: "PLANTA", industry: "Metalmecánica" });
  revisar("devuelve el contexto de instalación", soloTipo !== null);
  revisar("y todavía no habla por la empresa",
    soloTipo !== null && !("dichoPorLaEmpresa" in soloTipo));

  console.log("\nCon lo que contó la empresa");
  const completo = contextoDeLaEmpresa({
    tipoInstalacion: "PLANTA",
    industry: "Metalmecánica",
    queProduce: "Piezas maquinadas para la industria automotriz.",
    noPuedeParar: "La grúa viajera: sin ella no se mueve material.",
  });
  revisar("incluye lo que dijo la empresa",
    completo !== null && "dichoPorLaEmpresa" in completo);
  const dicho = (completo as { dichoPorLaEmpresa: Record<string, string> }).dichoPorLaEmpresa;
  revisar("solo van las contestadas, no las vacías",
    Object.keys(dicho).length === 2, Object.keys(dicho).join(", "));
  revisar("conserva la restricción tal cual",
    dicho.noPuedeParar.includes("grúa viajera"));

  console.log("\nSe le dice al modelo qué es esto y qué NO es");
  // Sin esta etiqueta el modelo trata lo declarado como hecho medido, y el dia
  // que el cliente escriba "somos muy buenos en preventivo" le va a creer.
  const guia = (completo as { comoUsarlo: string }).comoUsarlo;
  revisar("advierte que es declarado, no medido", /no medido/i.test(guia));
  revisar("dice que mandan los datos si contradicen", /mandan los datos/i.test(guia));
  revisar("y que no son instrucciones", /no son instrucciones/i.test(guia));

  console.log("\nUn contexto viejo se marca");
  const hace2anos = new Date(Date.now() - 730 * 86_400_000);
  revisar("dos años lo marca como envejecido",
    contextoEnvejecido({ contextoAt: hace2anos }));
  revisar("un mes no", !contextoEnvejecido({ contextoAt: new Date(Date.now() - 30 * 86_400_000) }));
  revisar("sin fecha no se inventa que esté viejo", !contextoEnvejecido({}));
  const viejo = contextoDeLaEmpresa({ queProduce: "Algo", contextoAt: hace2anos });
  revisar("y la advertencia viaja al prompt",
    viejo !== null && "advertencia" in viejo);

  console.log("\nEl texto largo se recorta antes de llegar al modelo");
  const enorme = contextoDeLaEmpresa({ queProduce: "x".repeat(5000) });
  const recortado = (enorme as { dichoPorLaEmpresa: Record<string, string> }).dichoPorLaEmpresa.queProduce;
  revisar("se topa en el largo máximo", recortado.length === LARGO_MAXIMO, `${recortado.length}`);

  console.log("\nLos ejemplos cambian según la instalación");
  // Un ejemplo que no le queda al usuario es peor que ninguno: lo manda a
  // contestar lo que no es.
  const p = PREGUNTAS.find((x) => x.clave === "noPuedeParar")!;
  revisar("a un hospital le toca uno de hospital",
    /gases medicinales|planta de emergencia/i.test(ejemploDe(p, "HOSPITAL")), ejemploDe(p, "HOSPITAL").slice(0, 40));
  revisar("a una planta le toca uno de planta",
    /grúa|compresor/i.test(ejemploDe(p, "PLANTA")));
  revisar("un tipo sin ejemplo propio cae en el general",
    ejemploDe(p, "ESCUELA").length > 0);

  console.log("\nEl conteo para la puesta en marcha");
  revisar("cuenta solo las contestadas",
    contestadas({ queProduce: "algo", comoOpera: "   ", noPuedeParar: "otra" }) === 2);

  console.log("\nLlega de verdad a la base y sale hacia la IA");
  const sello = `prueba-contexto-${Date.now()}`;
  const org = await prisma.organization.create({
    data: {
      name: sello, slug: sello, plan: "ENTERPRISE", tipoInstalacion: "PLANTA",
      queProduce: "Piezas para exportación",
      noPuedeParar: "El compresor de aire",
      contextoAt: new Date(),
    },
  });
  try {
    // Se lee como lo leen las funciones de IA, no con un select a modo: si el
    // campo no viaja en esa consulta, la IA nunca lo ve.
    const leida = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: {
        tipoInstalacion: true, industry: true, queProduce: true, comoOpera: true,
        noPuedeParar: true, dueleHoy: true, objetivoDelAno: true, contextoAt: true,
      },
    });
    const paraElPrompt = contextoDeLaEmpresa(leida);
    const d = (paraElPrompt as { dichoPorLaEmpresa: Record<string, string> }).dichoPorLaEmpresa;
    revisar("lo guardado llega al prompt", d.queProduce === "Piezas para exportación");
    revisar("incluida la restricción", d.noPuedeParar === "El compresor de aire");
    revisar("y sigue trayendo el tipo de instalación",
      paraElPrompt !== null && "tipo" in paraElPrompt);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
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
