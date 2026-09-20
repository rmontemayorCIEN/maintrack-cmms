/**
 * Comprueba que cada paro quedo con la empresa de su equipo. Solo lectura.
 * Nacio del relleno de `organizationId` en DowntimeEvent (Bloque 8).
 */
import { prisma } from "../lib/db";

(async () => {
  const paros = await prisma.downtimeEvent.findMany({
    select: { id: true, organizationId: true, asset: { select: { organizationId: true } } },
  });
  const cruzados = paros.filter((p) => p.organizationId !== p.asset.organizationId);
  console.log(`paros: ${paros.length} · con empresa distinta de su equipo: ${cruzados.length}`);
  if (cruzados.length) console.log(cruzados.slice(0, 10).map((c) => c.id));
  process.exit(cruzados.length ? 1 : 0);
})();
