/**
 * Ciclo completo de «que consume cada actividad» contra planes reales.
 *
 * El esquema se prueba en seco en `prueba-esquemas-ia.ts`. Esto es lo otro:
 * llamar al modelo de verdad y pasar su respuesta por `aterrizarPropuesta`,
 * que es la frontera de escritura. Lo que importa medir aqui es si el modelo
 * se INVENTA codigos: uno inventado terminaria en una requisicion de compra y
 * nadie lo notaria hasta que llegara la factura.
 *
 * No escribe nada en el plan: solo propone y valida.
 *
 *   ./scripts/con-produccion.sh scripts/prueba-recursos-plan-real.ts
 */
import { prisma } from "../lib/db";
import { aterrizarPropuesta, proponerRecursosDePlan } from "../lib/ia/recursos-plan";

let fallas = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 300)}` : ""}`);
}

async function main() {
  // Planes con actividades sin consumo cargado, que es el caso de uso.
  const todos = await prisma.maintenancePlan.findMany({
    where: { active: true, tasks: { some: { parts: { none: {} } } } },
    select: {
      id: true, name: true,
      organization: { select: { id: true, plan: true, iaComplemento: true, iaExtra: true, name: true } },
      _count: { select: { tasks: true } },
    },
    take: 40,
    orderBy: { createdAt: "desc" },
  });

  /**
   * Uno por empresa, y con catálogo que dé para proponer.
   *
   * Tomando los tres más recientes salieron los tres de la misma cuenta y los
   * tres de inspección: el modelo contestó bien «no consume» y la prueba no
   * midió lo único que faltaba medir —si acierta cuando SÍ hay que proponer—.
   */
  const porEmpresa = new Map<string, (typeof todos)[number]>();
  for (const x of todos) if (!porEmpresa.has(x.organization.id)) porEmpresa.set(x.organization.id, x);
  const planes = [...porEmpresa.values()].slice(0, 4);

  if (!planes.length) {
    console.log("No hay planes con actividades sin consumo cargado. Nada que probar.");
    return;
  }

  let costo = 0;
  for (const p of planes) {
    console.log(`\n${p.organization.name} · ${p.name} (${p._count.tasks} actividades)`);
    const r = await proponerRecursosDePlan(
      { id: p.organization.id, plan: p.organization.plan, iaComplemento: p.organization.iaComplemento, iaExtra: p.organization.iaExtra },
      { planId: p.id },
    );
    if (!r.ok) { console.log(`  (no aplica: ${r.motivo})`); continue; }
    costo += r.costoUsd;

    const catalogo = await prisma.part.findMany({
      where: { organizationId: p.organization.id, active: true },
      select: { id: true, code: true, name: true, unit: true },
    });
    const a = aterrizarPropuesta(r.propuesta, r.actividades, catalogo);

    revisar("no inventó códigos fuera del catálogo", a.inventadas.length === 0, a.inventadas);
    revisar("cada actividad aparece una sola vez, en una de las tres listas",
      (() => {
        const vistas = [
          ...a.lineas.map((l) => l.taskId),
          ...a.sinConsumo.map((s) => s.id),
          ...a.sinCatalogo.map((s) => s.taskId),
        ];
        return new Set(vistas).size === vistas.length;
      })(),
      { propuestas: a.lineas.length, sinConsumo: a.sinConsumo.length, sinCatalogo: a.sinCatalogo.length });
    revisar("las cantidades son por ejecución, no por año (ninguna absurda)",
      a.lineas.every((l) => l.refacciones.every((x) => x.cantidad > 0 && x.cantidad <= 50)),
      a.lineas.flatMap((l) => l.refacciones.map((x) => `${x.code}:${x.cantidad}`)));
    revisar("contestó algo útil: o propuso material, o dijo que no consume",
      a.lineas.length + a.sinConsumo.length + a.sinCatalogo.length > 0);
    // Lo que falta en el catálogo tiene que venir LISTO para darse de alta: sin
    // código, nombre y unidad, la lista solo sirve para leerla.
    revisar("lo que falta en catálogo viene con su alta armada, y el código no choca con uno existente",
      a.sinCatalogo.every((x) => x.nombre.length > 2 && x.unidad.length > 0 && x.cantidad > 0)
      && a.sinCatalogo.every((x) => !x.codigoOcupado || x.codigo.length > 0),
      a.sinCatalogo.map((x) => `${x.codigo || "(sin código)"} · ${x.nombre} (${x.unidad}) x${x.cantidad}${x.codigoOcupado ? " ¡OCUPADO!" : ""}`));

    for (const l of a.lineas) {
      console.log(`    ${l.titulo}`);
      for (const x of l.refacciones) console.log(`      · ${x.cantidad} ${x.unit} de ${x.code} — ${x.porQue}`);
    }
    if (a.sinConsumo.length) console.log(`    sin consumo: ${a.sinConsumo.map((s) => s.titulo).join("; ")}`);
    for (const x of a.sinCatalogo) {
      console.log(`    falta: ${x.codigo} · ${x.nombre} (${x.unidad}) x${x.cantidad}${x.codigoOcupado ? "  ← código ocupado" : ""}`);
      console.log(`       para: ${x.titulo} — ${x.queFalta}`);
    }
  }

  console.log(`\nCosto del ciclo: ${costo.toFixed(4)} USD`);
  console.log(fallas ? `\n✗ ${fallas} fallas` : "\n✓ La propuesta se ancla al catálogo y no inventa");
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
