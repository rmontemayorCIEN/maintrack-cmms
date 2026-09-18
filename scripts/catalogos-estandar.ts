/**
 * Carga los catálogos estándar de cada empresa, según su tipo de instalación.
 *
 *   npx tsx scripts/catalogos-estandar.ts                       (ensayo: solo dice qué faltaría)
 *   npx tsx scripts/catalogos-estandar.ts --aplicar
 *   ... --org "Nombre de la empresa"     (por omisión: todas)
 *
 * Usa la MISMA lista que el sistema (`lib/catalogos-estandar.ts`). Antes este
 * script traía su propia copia, que ya no coincidía con la del alta de
 * empresas. Es aditivo e idempotente: no toca lo que ya exista con el mismo
 * código, no borra nada y se puede volver a correr sin efecto.
 */
import { prisma } from "../lib/db";
import { catalogosPara, sembrarCatalogosEstandar } from "../lib/catalogos-estandar";

const aplicar = process.argv.includes("--aplicar");
const i = process.argv.indexOf("--org");
const soloOrg = i > -1 ? process.argv[i + 1] : null;

async function main() {
  const orgs = await prisma.organization.findMany({
    where: soloOrg ? { name: soloOrg } : {},
    select: { id: true, name: true, tipoInstalacion: true },
  });
  if (!orgs.length) {
    console.log(soloOrg ? `No existe la empresa «${soloOrg}».` : "No hay empresas.");
    return;
  }

  for (const org of orgs) {
    if (aplicar) {
      const r = await sembrarCatalogosEstandar(org.id, org.tipoInstalacion);
      const total = Object.values(r).reduce((s, n) => s + n, 0);
      console.log(`${org.name} (${org.tipoInstalacion ?? "sin tipo"}): ${total} registros nuevos`, r);
    } else {
      const c = catalogosPara(org.tipoInstalacion);
      const faltan = {
        categorias: c.categorias.length - await prisma.assetCategory.count({ where: { organizationId: org.id, code: { in: c.categorias.map((x) => x[0]) } } }),
        codigosFalla: c.codigosFalla.length - await prisma.failureCode.count({ where: { organizationId: org.id, code: { in: c.codigosFalla.map((x) => x[0]) } } }),
        familias: c.familias.length - await prisma.partCategory.count({ where: { organizationId: org.id, code: { in: c.familias.map((x) => x[0]) } } }),
      };
      console.log(`${org.name} (${org.tipoInstalacion ?? "sin tipo"}): faltarían`, faltan);
    }
  }
  if (!aplicar) console.log("\nEnsayo. Para escribir: agregue --aplicar");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
