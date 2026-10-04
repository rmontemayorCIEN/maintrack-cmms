/**
 * Cobranza: que la factura cobre lo que debe, ni un peso mas ni uno menos.
 *
 * Llama a `emitirCargosDelPeriodo`, la MISMA funcion que corre en produccion.
 * Una prueba que sumara el plan y los complementos por su cuenta no probaria
 * nada: acertaria aunque la cobranza se equivocara.
 *
 * Esto no existia. El calculo que decide cuanto se le cobra a un cliente era
 * lo unico del sistema sin una sola prueba.
 *
 *   npx tsx scripts/prueba-cobranza.ts
 */
import { prisma } from "../lib/db";
import { emitirCargosDelPeriodo } from "../lib/cobranza";
import { COMPLEMENTOS, COMPLEMENTO_IA, COMPLEMENTO_NORMAS, COMPLEMENTO_REGISTROS, PLANES } from "../lib/planes";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 200)}` : ""}`);
}

const sello = `cobranza-${Date.now()}`;
const PERIODO = "2099-01";   // lejano: no choca con cargos reales de nadie
const creadas: string[] = [];

async function empresa(nombre: string, datos: Record<string, unknown>) {
  const o = await prisma.organization.create({
    data: { name: `${sello}-${nombre}`, slug: `${sello}-${nombre}`, plan: "PROFESSIONAL", status: "ACTIVE", ...datos },
  });
  creadas.push(o.id);
  return o;
}

/** El cargo de ESA empresa, acotado por id. Los folios no son globales. */
async function cargoDe(orgId: string) {
  return prisma.invoice.findFirst({ where: { organizationId: orgId, periodo: PERIODO } });
}

async function main() {
  console.log("\nCobranza: lo que se le cobra a cada quien\n");

  const PROF = PLANES.PROFESSIONAL.precioMensual;

  console.log("1. El plan solo\n");
  const sola = await empresa("sola", {});
  await emitirCargosDelPeriodo(PERIODO, { organizationId: sola.id });
  const c1 = await cargoDe(sola.id);
  revisar("un plan sin complementos cobra el plan", c1?.importe === PROF, { esperado: PROF, cobrado: c1?.importe });
  revisar("y el concepto no menciona complementos", Boolean(c1 && !c1.concepto.includes("+")), c1?.concepto);

  console.log("\n2. Cada complemento suma su precio\n");
  for (const [clave, campo, def] of [
    ["IA", "iaComplemento", COMPLEMENTO_IA],
    ["registros", "registrosPropios", COMPLEMENTO_REGISTROS],
    ["normas", "cumplimientoNormas", COMPLEMENTO_NORMAS],
  ] as const) {
    const o = await empresa(clave, { [campo]: true });
    await emitirCargosDelPeriodo(PERIODO, { organizationId: o.id });
    const c = await cargoDe(o.id);
    revisar(`${def.nombre} suma ${def.precioMensual}`, c?.importe === PROF + def.precioMensual,
      { esperado: PROF + def.precioMensual, cobrado: c?.importe });
    revisar(`   y aparece en el concepto`, Boolean(c?.concepto.includes(def.nombre)), c?.concepto);
  }

  console.log("\n3. Los tres juntos\n");
  const todo = await empresa("todo", { iaComplemento: true, registrosPropios: true, cumplimientoNormas: true });
  await emitirCargosDelPeriodo(PERIODO, { organizationId: todo.id });
  const c3 = await cargoDe(todo.id);
  const esperado = PROF + COMPLEMENTOS.reduce((t, c) => t + c.precioMensual, 0);
  revisar("cobra el plan mas los tres complementos", c3?.importe === esperado, { esperado, cobrado: c3?.importe });
  revisar("   y los nombra a los tres",
    Boolean(c3 && COMPLEMENTOS.every((x) => c3.concepto.includes(x.nombre))), c3?.concepto);

  console.log("\n4. Lo que NO se cobra\n");
  const demo = await empresa("demo", { esDemo: true, iaComplemento: true });
  const r = await emitirCargosDelPeriodo(PERIODO, { organizationId: demo.id });
  revisar("una empresa demostrativa no genera cargo", (await cargoDe(demo.id)) === null && r.emitidos === 0, r.omitidos);

  const interna = await empresa("interna", { cuentaInterna: true });
  await emitirCargosDelPeriodo(PERIODO, { organizationId: interna.id });
  revisar("una cuenta interna del operador tampoco", (await cargoDe(interna.id)) === null);

  const prueba = await empresa("enprueba", {
    status: "TRIAL", trialEndsAt: new Date(Date.now() + 30 * 86_400_000), cumplimientoNormas: true,
  });
  await emitirCargosDelPeriodo(PERIODO, { organizationId: prueba.id });
  revisar("una cuenta en periodo de prueba vigente tampoco", (await cargoDe(prueba.id)) === null);

  console.log("\n5. No se duplica\n");
  await emitirCargosDelPeriodo(PERIODO, { organizationId: todo.id });
  const cuantos = await prisma.invoice.count({ where: { organizationId: todo.id, periodo: PERIODO } });
  revisar("volver a emitir el mismo periodo no crea otro cargo", cuantos === 1, { cargos: cuantos });
}

main()
  .catch((e) => { console.error(e); fallos++; })
  .finally(async () => {
    for (const id of creadas) {
      await prisma.invoice.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log(fallos ? `\n  ${fallos} revision(es) fallaron\n` : "\n  ✓ Todo bien\n");
    process.exit(fallos ? 1 : 0);
  });
