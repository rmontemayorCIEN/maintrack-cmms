/**
 * Los dictados recientes: si llegaron, cuanto duraron y cuanto costaron.
 *
 * Sirve para dos cosas. La primera, confirmar que el dictado funciona desde un
 * telefono de verdad: la pantalla ya lo enseña, pero solo esto dice cuantos
 * segundos proceso Google y si quedo registrado el consumo. La segunda, ver si
 * alguna cuenta se esta acercando a su bolsa antes de que se le acabe.
 *
 * Los que salen con `ok: false` son audios que no se entendieron: cuestan
 * igual —Google ya escucho— pero no le descuentan nada al cliente.
 *
 *   ./scripts/con-produccion.sh scripts/diagnostico-dictados.ts
 */
import { prisma } from "../lib/db";
import { periodoActual } from "../lib/ia/consumo";
import { iaDeLaOrganizacion } from "../lib/planes";

async function main() {
  const registros = await prisma.aiUsage.findMany({
    where: { funcion: "DICTADO" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      createdAt: true, inputTokens: true, costoUsd: true, ok: true, operaciones: true,
      organization: { select: { name: true, plan: true, iaComplemento: true, iaExtra: true } },
      user: { select: { name: true, role: true } },
    },
  });

  if (!registros.length) {
    console.log("\n  Todavía no hay ningún dictado registrado.\n");
    return;
  }

  console.log(`\nÚltimos ${registros.length} dictados\n`);
  for (const r of registros) {
    const cuando = r.createdAt.toLocaleString("es-MX", { timeZone: "America/Monterrey" });
    // `inputTokens` guarda los SEGUNDOS facturados: es un prestamo de campo,
    // igual que la voz guarda ahi los caracteres.
    console.log(
      `  ${r.ok ? "entendido " : "sin entender"} · ${cuando} · ${String(r.inputTokens).padStart(3)} s · ` +
      `${r.costoUsd.toFixed(4)} USD · ${r.organization.name} · ${r.user?.name ?? "—"} (${r.user?.role ?? "—"})`,
    );
  }

  console.log("\nCómo va la bolsa de cada empresa este mes\n");
  const porOrg = await prisma.aiUsage.groupBy({
    by: ["organizationId"],
    where: { funcion: "DICTADO", periodo: periodoActual(), ok: true },
    _count: { id: true },
    _sum: { costoUsd: true, inputTokens: true },
  });
  for (const fila of porOrg) {
    const org = await prisma.organization.findUnique({
      where: { id: fila.organizationId },
      select: { name: true, plan: true, iaComplemento: true, iaExtra: true },
    });
    if (!org) continue;
    const cupo = iaDeLaOrganizacion(org).bolsas.DICTADO;
    const usados = fila._count.id;
    // Sin redondear a minutos ni a centavos: con poco uso, redondear deja
    // «0 min · 0.00 USD», que se lee como si no se hubiera usado nada.
    const seg = fila._sum.inputTokens ?? 0;
    const tiempo = seg < 120 ? `${seg} s` : `${(seg / 60).toFixed(1)} min`;
    console.log(`  ${org.name}: ${usados} de ${cupo} · ${tiempo} · ${(fila._sum.costoUsd ?? 0).toFixed(4)} USD`);
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
