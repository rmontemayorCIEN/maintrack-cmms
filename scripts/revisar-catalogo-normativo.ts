/**
 * Revisa el paquete del catálogo normativo.
 *
 *   npx tsx scripts/revisar-catalogo-normativo.ts
 *
 * Corre en el despliegue y BLOQUEA. La razón de que bloquee y no solo avise:
 * un catálogo mal formado no falla de manera ruidosa, falla callado — una
 * norma sin «fueraDeAlcance» deja al cliente creyendo que con eso ya cumplió
 * todo, y eso no se nota hasta la inspección.
 *
 * Las reglas viven en `lib/normas-revision.ts` para que la prueba ejercite
 * exactamente lo mismo que corre aquí.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PUBLICADO_CATALOGO, REVISADO_POR, TOTAL_OBLIGACIONES, VERSION_CATALOGO, NORMAS } from "../lib/normas-catalogo";
import { problemasContraAnterior, problemasDeCoherencia, problemasDeForma, type Hallazgo } from "../lib/normas-revision";

const RUTA = "catalogo-normativo/normas.json";

function main() {
  console.log(`\nCatálogo normativo — contenido v${VERSION_CATALOGO}, publicado ${PUBLICADO_CATALOGO}`);
  console.log(`${NORMAS.length} normas, ${TOTAL_OBLIGACIONES} obligaciones\n`);

  const crudo = JSON.parse(readFileSync(RUTA, "utf8"));
  const hallazgos: Hallazgo[] = [...problemasDeForma(crudo), ...problemasDeCoherencia(crudo)];

  /*
   * Contra la versión anterior en git. Esto es justo lo que hace valioso tener
   * el contenido versionado: se puede comparar con lo que decía antes.
   */
  try {
    const antes = JSON.parse(execSync(`git show HEAD:${RUTA} 2>/dev/null`, { encoding: "utf8" }));
    hallazgos.push(...problemasContraAnterior(antes, crudo));
    console.log("  ok    comparado contra la versión anterior en git");
  } catch {
    console.log("  ok    (sin versión anterior en git contra la cual comparar)");
  }

  const graves = hallazgos.filter((h) => h.grave);
  const avisos = hallazgos.filter((h) => !h.grave);

  if (!graves.length) console.log("  ok    forma, claves, tipos y giros en orden");
  for (const g of graves) console.log(`  FALLA ${g.texto}`);
  for (const a of avisos) console.log(`  aviso ${a.texto}`);

  if (!REVISADO_POR) {
    console.log("  aviso el contenido NO lo ha revisado un especialista: sigue marcado como borrador en pantalla, y así debe quedarse hasta que alguien lo revise");
  } else {
    console.log(`  ok    revisado por ${REVISADO_POR.nombre} el ${REVISADO_POR.fecha}`);
  }

  console.log(
    graves.length
      ? `\n✗ ${graves.length} problema(s). El catálogo no debe publicarse así.\n`
      : `\n✓ El catálogo está bien formado${avisos.length ? ` (${avisos.length} aviso${avisos.length === 1 ? "" : "s"})` : ""}.\n`,
  );
  process.exit(graves.length ? 1 : 0);
}

main();
