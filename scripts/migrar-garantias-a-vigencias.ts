/**
 * Las garantias que ya estaban en el activo se vuelven Vigencias.
 *
 * `Asset.warrantyExpiry` guardaba una fecha y nada mas: ni de quien se
 * reclama, ni que cubre, ni aviso al vencerse. Esos datos no se pierden —la
 * columna se queda como cache, ver `lib/vigencias.ts`— pero para que avisen y
 * para que salten al abrir una correctiva tienen que existir como Vigencia.
 *
 *   npx tsx scripts/migrar-garantias-a-vigencias.ts            # solo reporta
 *   npx tsx scripts/migrar-garantias-a-vigencias.ts --aplicar  # escribe
 *
 * Se puede correr dos veces: no duplica. Reconoce lo ya migrado por tener una
 * garantia activa con la misma fecha.
 */
import { prisma } from "../lib/db";

const APLICAR = process.argv.includes("--aplicar");

async function main() {
  const activos = await prisma.asset.findMany({
    where: { warrantyExpiry: { not: null } },
    select: {
      id: true, code: true, name: true, organizationId: true, warrantyExpiry: true, purchaseDate: true,
      organization: { select: { name: true, slug: true } },
      vigencias: { where: { tipo: "GARANTIA" }, select: { id: true, hasta: true, activa: true } },
    },
    orderBy: { code: "asc" },
  });

  const porHacer = activos.filter((a) =>
    !a.vigencias.some((v) => v.activa && v.hasta?.getTime() === a.warrantyExpiry!.getTime()));

  console.log(`Activos con fecha de garantía: ${activos.length}`);
  console.log(`Ya migrados: ${activos.length - porHacer.length}`);
  console.log(`Por migrar: ${porHacer.length}\n`);

  const hoy = new Date();
  for (const a of porHacer) {
    const vence = a.warrantyExpiry!;
    const estado = vence < hoy ? "vencida" : "vigente";
    console.log(`  [${a.organization.slug}] ${a.organization.name} · ${a.code} · ${a.name} → hasta ${vence.toISOString().slice(0, 10)} (${estado})`);
    if (!APLICAR) continue;
    await prisma.vigencia.create({
      data: {
        organizationId: a.organizationId,
        assetId: a.id,
        tipo: "GARANTIA",
        titulo: "Garantía del equipo",
        // La fecha de compra, cuando esta, es el inicio razonable. No se
        // inventa cuando no esta: una garantia sin fecha de inicio sigue
        // sirviendo, y una fecha inventada ensucia el expediente.
        desde: a.purchaseDate ?? null,
        hasta: vence,
        nota: "Registrada al pasar las garantías del catálogo de activos a vigencias.",
      },
    });
  }

  if (!APLICAR) {
    console.log(`\nEnsayo. Con --aplicar se crean ${porHacer.length} vigencia(s).`);
  } else {
    console.log(`\n✓ ${porHacer.length} garantía(s) registradas como vigencia.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
