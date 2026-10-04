/**
 * La voz del parte (lib/voz.ts), sin llamar a Google.
 *
 * Lo que se cuida: que las marcas de pausa se escriban donde van y no en medio
 * de una cifra, que un texto con corchetes no meta una marca inventada, y que
 * la huella cambie cuando cambia lo que suena —si no, se seguiria oyendo el
 * audio viejo despues de cambiar la voz—.
 *
 *   npx tsx scripts/prueba-voz.ts
 */
import { conPausas, huella, nombreDeVoz, paraDecir, RITMO, VOCES, VOZ_POR_OMISION, vozValida } from "../lib/voz";
import { HAY_MAS_ESCRITO, LARGOS_DE_RESPUESTA, LARGO_POR_OMISION, largoDe, loQueSeDice } from "../lib/respuestas-voz";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle = "") {
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${detalle ? ` · ${detalle}` : ""}`);
  if (!bien) fallas++;
}

console.log("\nLas pausas\n");

const parte = "Buenos días, Rafael. Trae abajo el compresor. Se le juntaron 12 órdenes vencidas; la más vieja lleva 19 días.";
const marcado = conPausas(parte);
console.log(`  «${marcado}»\n`);

revisar("pone pausa larga entre oraciones", (marcado.match(/\[pause\]/g) ?? []).length === 2, marcado);
revisar("pone pausa corta donde hay punto y coma", marcado.includes("[pause short]"));
revisar("no parte una cifra a la mitad", !/1\s*\[pause/.test(marcado) && marcado.includes("12 órdenes"));
revisar("no deja una pausa al final, donde ya nada sigue", !marcado.trimEnd().endsWith("[pause]"), marcado.slice(-30));
revisar("conserva todas las cifras", ["12", "19"].every((n) => marcado.includes(n)));

console.log("\nTexto que trae corchetes\n");
const conCorchetes = conPausas("Revisar la Bomba [respaldo] del área. Ya lleva 3 días.");
revisar("los corchetes del dato no se confunden con una marca",
  !conCorchetes.includes("[respaldo]") && conCorchetes.includes("respaldo"), conCorchetes);
revisar("y las marcas de verdad sí quedan", conCorchetes.includes("[pause]"), conCorchetes);

console.log("\nDecimales y abreviaturas\n");
const decimal = conPausas("La disponibilidad quedó en 99.9 por ciento. Subió.");
revisar("un punto decimal NO abre una pausa",
  !decimal.includes("99. [pause] 9") && decimal.includes("99.9"), decimal);

console.log("\nLa huella del audio guardado\n");
const voz = nombreDeVoz(VOZ_POR_OMISION);
const a = huella("mismo texto", voz);
revisar("el mismo texto y la misma voz dan la misma huella", a === huella("mismo texto", voz));
revisar("otro texto da otra huella", a !== huella("otro texto", voz));
revisar("CAMBIAR DE VOZ da otra huella: si no, se seguiría oyendo la vieja",
  a !== huella("mismo texto", nombreDeVoz("Orus")), "Despina contra Orus");

console.log("\nEl catálogo de voces\n");
revisar("todas son de español latino, ninguna de España",
  VOCES.every((v) => nombreDeVoz(v.id).startsWith("es-US-")), `${VOCES.length} voces`);
revisar("todas son neuronales de las buenas", VOCES.every((v) => nombreDeVoz(v.id).includes("Chirp3-HD")));
revisar("hay voces de hombre y de mujer",
  VOCES.some((v) => v.quien === "hombre") && VOCES.some((v) => v.quien === "mujer"),
  `${VOCES.filter((v) => v.quien === "mujer").length} y ${VOCES.filter((v) => v.quien === "hombre").length}`);
revisar("cada una dice cómo suena, para poder escoger sin oírlas todas",
  VOCES.every((v) => v.como.length > 4));
revisar("ninguna clave repetida", new Set(VOCES.map((v) => v.id)).size === VOCES.length);
revisar("la de omisión está en el catálogo", vozValida(VOZ_POR_OMISION), VOZ_POR_OMISION);

console.log("\nUna voz guardada que ya no ofrecemos\n");
revisar("una clave desconocida NO se acepta", !vozValida("VozQueYaNoExiste"));
revisar("y cae a la de omisión en vez de romper",
  nombreDeVoz("VozQueYaNoExiste") === nombreDeVoz(VOZ_POR_OMISION), nombreDeVoz("VozQueYaNoExiste"));
revisar("sin preferencia, también la de omisión", nombreDeVoz(null) === nombreDeVoz(VOZ_POR_OMISION));

revisar("se lee más lento que lo normal", RITMO < 1, String(RITMO));

console.log("\nLo escrito para leerse, dicho en voz alta\n");

const importe = paraDecir("El costo fue de $128,400.50 en 90 días.");
revisar("un importe se dice como lo diría una persona",
  importe.includes("128 mil 400 pesos") && !importe.includes("$"), importe);
revisar("NO redondea la cifra: el número es la respuesta", importe.includes("400"), importe);

revisar("los millones llevan «de»",
  paraDecir("Costó $2,500,000.").includes("millones de pesos"), paraDecir("Costó $2,500,000."));
revisar("«$45 pesos» no sale «45 pesos pesos»",
  !paraDecir("Son $45 pesos.").includes("pesos pesos"), paraDecir("Son $45 pesos."));
/**
 * Sin el signo de pesos tambien.
 *
 * «El gasto fue de 11,430» se oia «once, cuatro treinta»: el sintetizador
 * toma la coma como pausa y parte el numero en dos. Lo encontro Rafael
 * oyendolo —en pantalla el texto se ve perfecto— y afectaba a todo lo que el
 * modelo escribiera sin el signo, que es casi siempre.
 */
revisar("una cifra con separador de miles se dice entera, aunque no traiga signo",
  paraDecir("El gasto fue de 11,430 en el año").includes("11 mil 430"),
  paraDecir("El gasto fue de 11,430 en el año"));
revisar("   y no queda ninguna coma partiendo el número",
  !paraDecir("Hay 1,250 piezas").includes("1,250"), paraDecir("Hay 1,250 piezas"));
// «Mil doscientos», no «un mil doscientos»: nadie lo dice asi.
revisar("   el millar no se dice «un mil»",
  paraDecir("Hay 1,250 piezas").includes("mil 250") && !paraDecir("Hay 1,250 piezas").includes("1 mil"),
  paraDecir("Hay 1,250 piezas"));
// La preposicion que pone `miles()` y la que ya traia el texto no se suman.
revisar("y no salen dos «de» seguidos en los millones",
  !paraDecir("Van 3,000,000 de pesos").includes("de de"), paraDecir("Van 3,000,000 de pesos"));

revisar("el porcentaje se dice, no se deletrea el símbolo",
  paraDecir("Quedó en 87.5% este mes.").includes("87.5 por ciento"), paraDecir("Quedó en 87.5% este mes."));

const lista = paraDecir("- Revisar CMP-301\n- Cambiar BOM-602");
// Ojo: no vale buscar «-» a secas, que los codigos de equipo lo llevan.
revisar("las viñetas no se oyen como «guion»", !/(^|\s)[-•*]\s/.test(lista), lista);
revisar("y cada renglón cierra, para que no se digan de corrido",
  lista.includes("CMP-301. Cambiar"), lista);

revisar("los códigos de equipo se dicen tal cual: así se llaman en la planta",
  paraDecir("Falló CMP-301 y BOM-602.").includes("CMP-301") && paraDecir("Falló CMP-301 y BOM-602.").includes("BOM-602"));
revisar("el markdown que a veces cuela el modelo no se lee",
  paraDecir("**Resumen:** tres fallas.") === "Resumen: tres fallas.", paraDecir("**Resumen:** tres fallas."));
revisar("un texto ya limpio no se estropea",
  paraDecir("La bomba falló tres veces en septiembre.") === "La bomba falló tres veces en septiembre.");

console.log("\nLas siglas del oficio, dichas completas\n");

// Salen del GLOSARIO, no de una lista aparte: tener dos vocabularios seria
// garantizar que un dia digan cosas distintas.
revisar("MTBF se dice completo",
  paraDecir("El MTBF subió.").includes("tiempo medio entre fallas"), paraDecir("El MTBF subió."));
revisar("MTTR también", paraDecir("El MTTR bajó.").includes("tiempo medio de reparación"));
revisar("y las que se escriben con minúscula dentro, como PdM",
  paraDecir("El PdM ayuda.").includes("mantenimiento predictivo"), paraDecir("El PdM ayuda."));
revisar("el artículo concuerda con el nombre largo",
  paraDecir("El OEE quedó en 72%.").startsWith("La eficiencia"), paraDecir("El OEE quedó en 72%."));
revisar("una palabra del glosario que NO es sigla se deja en paz",
  paraDecir("El backlog creció.") === "El backlog creció.", paraDecir("El backlog creció."));

console.log("\nLos folios y las abreviaturas de escritura\n");
revisar("un folio se dice como lo diría una persona",
  paraDecir("La OT-000040 está abierta.") === "La orden 40 está abierta.", paraDecir("La OT-000040 está abierta."));
revisar("sin duplicar el artículo que ya traía",
  !paraDecir("La OT-000040 está abierta.").includes("La la"));
revisar("sin folio, se pone el artículo",
  paraDecir("Revisar OT-000090.").includes("la orden 90"), paraDecir("Revisar OT-000090."));
revisar("«h. hombre» se dice horas hombre",
  paraDecir("Lleva 12 h. hombre.").includes("12 horas hombre"), paraDecir("Lleva 12 h. hombre."));
revisar("las unidades se dicen, no se deletrean",
  paraDecir("Motor de 50 HP a 1750 RPM.").includes("caballos de fuerza"), paraDecir("Motor de 50 HP a 1750 RPM."));
revisar("los códigos de equipo NO se tocan: así se llaman en la planta",
  paraDecir("Revisar CMP-301 y BOM-602.") === "Revisar CMP-301 y BOM-602.", paraDecir("Revisar CMP-301 y BOM-602."));

/**
 * Que hablar quede registrado.
 *
 * Sin medicion no hay forma de poner un tope ni de saber quien gasta: el
 * primer aviso de que alguien se emociono llegaria en la factura de Google.
 * Se comprueba contra la base, con una sintesis de mentiras —no se llama al
 * modelo aqui—, verificando lo que se guarda y lo que NO se descuenta.
 */
async function consumo() {
  const { prisma } = await import("../lib/db");
  const { registrarVoz } = await import("../lib/ia/consumo");
  const { consumoIa } = await import("../lib/ia/consumo");

  const sello = `voz-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5" },
  });
  try {
    console.log("\nQue hablar quede registrado\n");
    const antes = await consumoIa(org.id);
    await registrarVoz({ organizationId: org.id, voz: nombreDeVoz(null), caracteres: 455, costoUsd: 0.01365 });
    const despues = await consumoIa(org.id);

    revisar("el gasto de voz queda anotado", despues.llamadas === antes.llamadas + 1, `${despues.llamadas} llamadas`);
    revisar("con su costo, para poder sumarlo",
      Math.abs(despues.costoUsd - antes.costoUsd - 0.01365) < 0.000001, `$${despues.costoUsd.toFixed(5)}`);
    revisar("NO descuenta operaciones del plan del cliente",
      despues.operaciones === antes.operaciones, `${despues.operaciones} operaciones`);
    revisar("aparece separado, con su propio renglón",
      despues.porFuncion.some((f) => f.funcion === "VOZ"), despues.porFuncion.map((f) => f.funcion).join(", "));
    revisar("se guardan los caracteres, que es como cobra Google",
      despues.tokens - antes.tokens === 455, `${despues.tokens - antes.tokens}`);

    console.log("\nEl tope del mes\n");
    const { puedeHablar, TOPE_VOZ_MENSUAL, tieneChatDeVoz } = await import("../lib/voz");

    const antesDelTope = await puedeHablar({ id: org.id, plan: "ENTERPRISE" });
    revisar("con un audio generado, todavía se puede hablar", antesDelTope.puede,
      antesDelTope.puede ? `quedan ${antesDelTope.restantes}` : "");

    // Se llena la bolsa de un plan chico para ver el freno de verdad.
    const tope = TOPE_VOZ_MENSUAL.PROFESSIONAL;
    const { periodoActual } = await import("../lib/ia/consumo");
    const periodo = periodoActual();
    await prisma.aiUsage.createMany({
      data: Array.from({ length: tope }, () => ({
        organizationId: org.id, funcion: "VOZ", modelo: "prueba",
        operaciones: 0, costoUsd: 0.01, periodo, ok: true,
      })),
    });
    const alTope = await puedeHablar({ id: org.id, plan: "PROFESSIONAL" });
    revisar("al llegar al máximo del mes, se frena", !alTope.puede, alTope.puede ? "" : alTope.motivo.slice(0, 60));
    revisar("y el aviso dice que lo demás sigue igual",
      !alTope.puede && alTope.motivo.includes("sigue igual"), alTope.puede ? "" : alTope.motivo);

    const enterprise = await puedeHablar({ id: org.id, plan: "ENTERPRISE" });
    revisar("el plan grande tiene más margen que el chico", enterprise.puede,
      `Enterprise ${TOPE_VOZ_MENSUAL.ENTERPRISE} contra Professional ${tope}`);

    console.log("\nQué tanto contesta hablando\n");
    /**
     * Medido en producción con la pregunta de Rafael, «¿cuántos activos
     * tenemos?»: 735 caracteres, unos 53 segundos hablados. La respuesta que
     * se pidió cabe en el primer párrafo; lo demás es contexto que sí vale,
     * pero leído, no oído de pie.
     */
    // Copiada tal cual de la corrida contra producción, no aproximada: si se
    // resume aquí, la prueba mide un problema más chico que el real.
    const laDeRafael = [
      "Según los indicadores al corte del 24 de septiembre de 2026, tienen **18 equipos en servicio**, ninguno detenido, y de esos **9 son de criticidad alta** —es decir, la mitad del parque es crítico.",
      "Ese número es el de activos activos en operación; si hay equipos retirados, no entran en ese conteo (conservan su historial pero salen de las listas de trabajo). Para el padrón completo, incluyendo retirados y agrupado por sitio o categoría, la pantalla de Activos se lo arma con \"Agrupar por…\" y cada grupo trae su conteo.",
      "Un dato que vale la pena: con 18 equipos en servicio, el cumplimiento preventivo va en 45.9% y hay 17 órdenes de backlog, 13 de ellas vencidas. El parque es chico, así que ese atraso se concentra en pocos equipos.",
    ].join("\n\n");

    const concisa = loQueSeDice(laDeRafael, "CONCISA");
    revisar("concisa dice la respuesta y no el informe",
      concisa.texto.includes("18 equipos") && !concisa.texto.includes("backlog"),
      `${concisa.texto.length} de ${laDeRafael.length} caracteres`);
    revisar("   y avisa que hay más, para que nadie crea que eso es todo", concisa.hayMas);
    // ~14 caracteres por segundo hablando: el punto del ajuste son los segundos.
    revisar("   baja de ~53 segundos a menos de 20",
      concisa.texto.length / 14 < 20 && laDeRafael.length / 14 > 45,
      `${(concisa.texto.length / 14).toFixed(0)} s contra ${(laDeRafael.length / 14).toFixed(0)} s`);

    // El caso VIEJO sigue: completa dice todo, sin prometer un detalle aparte.
    const completa = loQueSeDice(laDeRafael, "COMPLETA");
    revisar("completa sigue diciendo todo", completa.texto === laDeRafael && !completa.hayMas);

    // Lo que NO debe pasar: cortar una frase a la mitad, o prometer detalle
    // que no existe.
    const deUnSoloParrafo = "Tienes 13 órdenes vencidas, las más atrasadas llevan 21 días.";
    const sinCortar = loQueSeDice(deUnSoloParrafo, "CONCISA");
    revisar("una respuesta de un solo párrafo no se corta",
      sinCortar.texto === deUnSoloParrafo && !sinCortar.hayMas);
    const deCorrido = "Frase uno. Frase dos. Frase tres, toda de corrido sin renglones en blanco.";
    revisar("   y una respuesta de corrido se dice entera, no a medias",
      loQueSeDice(deCorrido, "CONCISA").texto === deCorrido);
    revisar("   nunca termina a media frase",
      [laDeRafael, deUnSoloParrafo, deCorrido].every((t) => /[.!?»]$/.test(loQueSeDice(t, "CONCISA").texto.trim())));

    revisar("la de omisión es la concisa", LARGO_POR_OMISION === "CONCISA");
    revisar("   y un valor desconocido cae en ella, no revienta", largoDe("LO-QUE-SEA") === "CONCISA");
    revisar("   y quien no ha escogido nada también", largoDe(null) === "CONCISA");
    revisar("son dos opciones, no tres", LARGOS_DE_RESPUESTA.length === 2,
      LARGOS_DE_RESPUESTA.map((l) => l.etiqueta).join(" | "));
    revisar("el aviso de que hay más es una frase, no un párrafo", HAY_MAS_ESCRITO.length < 60, HAY_MAS_ESCRITO);

    console.log("\nEl chat con voz, solo donde se decidió\n");
    revisar("Enterprise sí lo tiene", tieneChatDeVoz("ENTERPRISE"));
    revisar("Professional NO", !tieneChatDeVoz("PROFESSIONAL"));
    revisar("una cuenta sin plan tampoco", !tieneChatDeVoz(null));
  } finally {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

consumo()
  .catch((e) => { console.error(e); fallas++; })
  .finally(() => {
    console.log(`\n${fallas ? `${fallas} FALLARON` : "Todo bien"}\n`);
    process.exit(fallas ? 1 : 0);
  });
