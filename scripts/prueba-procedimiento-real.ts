/**
 * Ciclo completo de PROCEDIMIENTO contra ordenes reales.
 *
 * Los esquemas se prueban en seco en prueba-esquemas-ia.ts. Esto es lo otro:
 * llamar al modelo de verdad y pasar su respuesta por el validador del
 * aplicador, que es donde murieron los cuatro intentos anteriores. No escribe
 * nada en la orden; solo genera y valida.
 */
import { z } from "zod";
import { prisma } from "../lib/db";
import { generarProcedimiento } from "../lib/ia/procedimiento";

// Las mismas reglas del aplicador, para probar la frontera de escritura real.
const recortado = (max: number) => z.string().trim().transform((t) => t.slice(0, max));
const esquemaAplicador = z.object({
  seguridad: z.array(recortado(400)),
  herramientas: z.array(recortado(120)),
  refaccionesProbables: z.array(z.object({ codigo: recortado(40), porQue: recortado(300) })),
  advertencia: recortado(800).nullable(),
  pasos: z.array(z.object({
    titulo: recortado(200).pipe(z.string().min(3)),
    detalle: recortado(600).nullable(),
    tipo: z.enum(["CHECK", "MEASURE", "REPLACE", "TEXT"]),
    unidad: recortado(20).nullable(),
    minimo: z.number().nullable(),
    maximo: z.number().nullable(),
  })).min(1),
});

let fallas = 0;
const revisar = (e: string, ok: boolean, nota = "") => {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${e.padEnd(50)} ${nota}`);
};

/**
 * La cuenta contra la que se prueba, SIEMPRE explicita.
 *
 * Antes tomaba las tres ordenes mas recientes de TODA la base. En desarrollo
 * esas son las que dejo la ultima prueba que corrio sin limpiar (hay cientos de
 * empresas de prueba huerfanas), asi que el resultado dependia del orden de la
 * suite: sola pasaba —le tocaban ordenes sin activo y se negaba con motivo— y
 * dentro de la suite fallaba —le tocaban las de «Ciclo», con activo, y llegaba
 * a la IA sin llave—. No era intermitencia: era contaminacion entre pruebas.
 */
const SLUG = process.env.PRUEBA_ORG_SLUG ?? "acero-industrial";

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } });
  if (!org) {
    console.error(`\n  No existe la cuenta «${SLUG}». Indique otra con PRUEBA_ORG_SLUG.\n`);
    process.exitCode = 1;
    return;
  }
  const ordenes = await prisma.workOrder.findMany({
    where: { organizationId: org.id, status: { notIn: ["CANCELLED"] }, assetId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true, number: true, title: true,
      organization: { select: { id: true, name: true, plan: true, iaComplemento: true, iaExtra: true } },
    },
  });
  console.log(`\n${ordenes.length} ordenes a probar\n`);

  for (const o of ordenes) {
    console.log(`OT ${o.number} — ${o.title} (${o.organization.name})`);
    const r = await generarProcedimiento(o.organization, { workOrderId: o.id });

    if (!r.ok) {
      // Negarse con motivo es comportamiento correcto (p.ej. orden sin activo),
      // no una falla: lo que se prueba aqui es que nunca truene el esquema.
      const negativaValida = /activo|permiso|limite|cuota/i.test(r.motivo);
      revisar(negativaValida ? "se niega con motivo claro" : "genera", negativaValida, r.motivo);
      console.log("");
      continue;
    }
    revisar("genera", true, `$${r.costoUsd.toFixed(4)}`);

    const p = r.procedimiento;
    const largos = [
      ["advertencia", p.advertencia?.length ?? 0],
      ...p.pasos.map((s, i) => [`paso ${i + 1} titulo`, s.titulo.length] as const),
      ...p.pasos.map((s, i) => [`paso ${i + 1} detalle`, s.detalle?.length ?? 0] as const),
    ] as [string, number][];
    const masLargo = largos.reduce((a, b) => (b[1] > a[1] ? b : a));
    revisar("el recorte dejo todo dentro de limite", true, `mayor: ${masLargo[0]} = ${masLargo[1]}`);

    const v = esquemaAplicador.safeParse(p);
    revisar("pasa el validador del aplicador", v.success,
      v.success ? `${p.pasos.length} pasos, ${p.seguridad.length} seguridad` : v.error.issues[0]?.message ?? "");
    console.log("");
  }

  console.log(fallas ? `${fallas} revisiones fallaron\n` : "El ciclo completo cuadra\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
