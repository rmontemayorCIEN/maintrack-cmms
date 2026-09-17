/**
 * Anula una lectura de medidor con el mecanismo trazable de `lib/medidores.ts`
 * (el mismo que el boton «Anular» de Medidores): no la borra, guarda motivo,
 * usuario y fecha, deja bitacora y recalcula el medidor y sus planes.
 *
 * Existe para ejecutar una anulacion aprobada cuando no se puede hacer desde la
 * pantalla con la sesion de quien la aprobo.
 *
 *   npx tsx scripts/anular-lectura.ts <slug-empresa> <id-lectura> <correo-o-id-usuario> "motivo"            # ensayo
 *   npx tsx scripts/anular-lectura.ts <slug-empresa> <id-lectura> <correo-o-id-usuario> "motivo" --aplicar
 */
import { prisma } from "../lib/db";
import { anularLectura, planearRecalculo } from "../lib/medidores";

async function main() {
  const [slug, lecturaId, quien, motivo] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const aplicar = process.argv.includes("--aplicar");
  if (!slug || !lecturaId || !quien || !motivo) {
    console.error('Uso: anular-lectura.ts <slug> <id-lectura> <usuario> "motivo" [--aplicar]');
    process.exit(1);
  }
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug }, select: { id: true, name: true, timezone: true } });
  const usuario = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id, OR: [{ id: quien }, { email: quien }] },
    select: { id: true, name: true },
  });
  const lectura = await prisma.meterReading.findFirstOrThrow({
    where: { id: lecturaId, organizationId: org.id },
    select: { id: true, value: true, readingAt: true, estado: true, meterId: true, meter: { select: { name: true, unit: true } } },
  });
  console.log(`${org.name} · ${lectura.meter.name}: lectura ${lectura.value} ${lectura.meter.unit} del ${lectura.readingAt.toISOString()} (${lectura.estado})`);
  console.log(`Responsable: ${usuario.name} · Motivo: ${motivo}`);
  const antes = await planearRecalculo(prisma, org.id, lectura.meterId, new Date(), org.timezone);
  console.log(`Antes: actual ${antes.antes.currentValue} · promedio ${antes.antes.dailyAverage.toFixed(2)}`);

  if (!aplicar) {
    console.log("ENSAYO: no se escribió nada. Repita con --aplicar.");
  } else {
    const r = await anularLectura({ organizationId: org.id, readingId: lectura.id, userId: usuario.id, motivo });
    console.log(`APLICADO: actual ${r.currentValue} · promedio ${r.dailyAverage.toFixed(2)} · vigente ${r.lecturaVigente} · planes recalculados ${r.planesRecalculados}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERROR:", e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1); });
