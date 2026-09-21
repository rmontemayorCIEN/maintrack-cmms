/** Cuanto pesa cada pieza del inicio, para decidir que conviene congelar. */
import { prisma } from "../lib/db";

async function medir(que: string, fn: () => Promise<unknown>) {
  await fn().catch(() => undefined);
  const t = Date.now();
  await fn();
  console.log(`  ${String(Date.now() - t).padStart(5)} ms  ${que}`);
}

(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { slug: "volumen-de-prueba" } });
  const o = org.id;
  const { calcularIndicadores } = await import("../lib/indicadores");
  const { revisarCalidad } = await import("../lib/calidad-datos");
  const { puestaEnMarcha } = await import("../lib/puesta-en-marcha");
  const { periodoIndicadores } = await import("../lib/periodos");
  const { refaccionesBajoMinimo, refaccionesCriticasAgotadas } = await import("../lib/avisos/situaciones");
  const { filtroDeVencidas } = await import("../lib/vencimiento");
  const p = periodoIndicadores(30, org.timezone);

  console.log("\nPiezas del inicio (empresa con un año de operación)\n");
  await medir("indicadores (30 días)", () => calcularIndicadores(o, p));
  await medir("calidad de datos", () => revisarCalidad(o));
  await medir("puesta en marcha", () => puestaEnMarcha(o));
  await medir("refacciones bajo mínimo", () => refaccionesBajoMinimo(o));
  await medir("refacciones críticas agotadas", () => refaccionesCriticasAgotadas(o));
  await medir("OT vencidas (conteo)", () => prisma.workOrder.count({ where: { organizationId: o, ...filtroDeVencidas(org.timezone) } }));
  await medir("OT críticas abiertas (conteo)", () => prisma.workOrder.count({ where: { organizationId: o, priority: "CRITICAL", status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } } }));
  await medir("compras por autorizar (conteo)", () => prisma.purchaseRequest.count({ where: { organizationId: o, estado: "SOLICITADA" } }));
  process.exit(0);
})();
