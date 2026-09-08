/**
 * Ciclo completo de PARO_AREA contra datos reales.
 *
 * El esquema se prueba en seco en prueba-esquemas-ia.ts. Esto es lo otro:
 * llamar al modelo de verdad y revisar que lo que devuelve SIRVE, que es algo
 * que ningun validador de forma puede comprobar.
 *
 * Lo que se mira aqui no es que la respuesta valide —eso ya lo garantiza el
 * esquema— sino tres cosas que solo se ven leyendo:
 *
 *   - que hable de dinero y de folios, no de MTBF
 *   - que NO se invente cifras: las que cite deben ser las que se le dieron
 *   - que use lo que el dueno declaro, cuando existe
 *
 * No escribe nada. Solo genera y revisa.
 *
 *   ./scripts/con-produccion.sh scripts/prueba-paros-real.ts
 */
import { prisma } from "../lib/db";
import { explicarParos } from "../lib/ia/paros";
import { costoDeParar, ventanas } from "../lib/costo-de-parar";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: "Acero Industrial del Norte (Demo)" },
    select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true, noPuedeParar: true },
  });
  if (!org) {
    console.error("\n  No se encontró la cuenta de demostración.\n");
    process.exit(1);
  }

  const v = ventanas("TRIMESTRE");
  const resumen = await costoDeParar(org.id, v.actual);
  const area = resumen.areas.find((a) => a.horasQueDetienen > 0);
  if (!area) {
    console.error("\n  Ningún área con paro que detenga producción. Nada que probar.\n");
    process.exit(1);
  }

  console.log(`\n  Cuenta: ${org.name}`);
  console.log(`  Área:   ${area.area} · ${area.horasQueDetienen} h · $${area.perdida.toLocaleString("es-MX")}`);
  console.log(`  Equipos: ${area.equipos.map((e) => e.code).join(", ")}\n`);
  console.log("  Llamando al modelo…\n");

  const r = await explicarParos(
    { id: org.id, plan: org.plan, iaComplemento: org.iaComplemento, iaExtra: org.iaExtra },
    { locationId: area.locationId, periodo: "TRIMESTRE", operador: true },
  );

  if (!r.ok) {
    console.error(`  Se negó: ${r.motivo}`);
    process.exit(1);
  }

  const a = r.analisis;
  console.log("  ── LO QUE DIJO ──\n");
  console.log(`  ${a.explicacion}\n`);
  if (a.loQueConecta) console.log(`  Lo que conecta: ${a.loQueConecta}\n`);
  if (a.contraLoQueDijo) console.log(`  Contra lo que dijo: ${a.contraLoQueDijo}\n`);
  console.log(`  Acción: ${a.accion.titulo}`);
  console.log(`          ${a.accion.porque}`);
  console.log(`          le toca a ${a.accion.quien}`);
  console.log(`  Confianza: ${a.confianza}`);
  console.log(`  Costó: $${r.costoUsd.toFixed(4)} USD\n`);

  const todo = [a.explicacion, a.loQueConecta ?? "", a.contraLoQueDijo ?? "", a.accion.porque].join(" ");

  console.log("  ── REVISIONES ──");

  revisar("cita folios de órdenes reales", /OT-\d+/.test(todo),
    (todo.match(/OT-\d+/g) ?? []).slice(0, 4).join(", ") || "ninguno");

  // Un dueno no lee MTBF. Si sale jerga, el prompt no esta mordiendo.
  revisar("habla en el idioma del dueño, sin jerga",
    !/\bMTBF\b|\bMTTR\b|disponibilidad\s+del?\s+\d/i.test(todo));

  // El modelo NO calcula: las cifras que cite deben venir de las que se le
  // dieron. Se revisa que no aparezca un peso que nadie le paso.
  const cifrasDadas = new Set<string>([
    String(Math.round(area.perdida)),
    String(area.horasQueDetienen),
    ...area.equipos.map((e) => String(Math.round(e.perdida))),
    ...area.equipos.map((e) => String(e.horas)),
    String(Math.round(resumen.perdida)),
  ]);
  /**
   * Se buscan los numeros CON COMA de millares: "43,960", "$127,960".
   *
   * La primera version solo miraba el signo de pesos, y el modelo escribio
   * "127,960 pesos" y "43,960 contra 47,600": la revision pasaba sin revisar
   * nada, que es peor que no tenerla.
   *
   * La coma es el filtro correcto: las horas y los conteos van sin ella —45.7,
   * 6 paros— asi que no ensucian, y los montos siempre la llevan.
   */
  const pesosCitados = (todo.match(/\d{1,3}(?:,\d{3})+/g) ?? []).map((t) => t.replace(/,/g, ""));
  const inventados = pesosCitados.filter((n) => !cifrasDadas.has(n));
  revisar("no inventa cifras de dinero", inventados.length === 0,
    inventados.length ? `sospechosas: ${inventados.join(", ")}` : `${pesosCitados.length} citadas, todas del contexto`);

  revisar("la acción es concreta, no un consejo general",
    a.accion.titulo.length > 15 && !/mejorar|optimizar|revisar todo/i.test(a.accion.titulo),
    a.accion.titulo);

  // Si el dueno declaro su restriccion, la respuesta deberia tocarla.
  if (org.noPuedeParar) {
    revisar("toma en cuenta lo que el dueño declaró", a.contraLoQueDijo !== null,
      a.contraLoQueDijo ? "sí lo contrastó" : "lo ignoró");
  }

  revisar("declara su confianza", ["ALTA", "MEDIA", "BAJA"].includes(a.confianza), a.confianza);

  console.log(fallos === 0 ? "\n  Todo correcto.\n" : `\n  ${fallos} revisión(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
