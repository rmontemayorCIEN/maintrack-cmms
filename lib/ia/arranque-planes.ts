/**
 * Por donde empezar los planes preventivos.
 *
 * El problema real: una cuenta con setenta y cuatro equipos y ningun plan. El
 * usuario abre la pantalla de planes, ve la hoja en blanco y no vuelve. Ahi
 * mueren las implementaciones de CMMS.
 *
 * Esta funcion NO escribe planes ni los asigna: propone el ORDEN de arranque
 * —que familia primero y por que— y para cada una sugiere como estructurarla.
 * El contenido de cada plan lo redacta despues generarPlan(), que ya existe;
 * esto es el paso anterior, el que hoy no tiene nadie.
 *
 * Los numeros —cuantos equipos, cuantos criticos, cuanto correctivo lleva cada
 * familia— se calculan en TypeScript. El modelo aporta el criterio de arranque,
 * que no es una formula: una planta no empieza por lo que mas equipos tiene
 * sino por lo que mas duele.
 */
import { z } from "zod";
import { prisma } from "../db";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";
import { coberturaPreventiva } from "../cobertura-planes";
import { constructorDePlanes } from "../constructor-planes";

const esquema = z.object({
  diagnostico: textoIa(
    420,
    "Como esta el programa preventivo de esta planta, en dos o tres frases. Sin adornos.",
  ),
  propuestas: z
    .array(
      z.object({
        familia: textoIa(80, "El nombre EXACTO de la categoría, como viene en los datos."),
        orden: z.number().int().describe("1 es lo primero que conviene hacer."),
        porQue: textoIa(260, "Por que esta familia va en ese lugar. Con el dato que lo sostiene."),
        /**
         * Cuantos planes faltan NO se le pregunta al modelo: lo cuenta el
         * constructor agrupando por modelo, y viene en el contexto. Lo que se
         * le pide aqui es lo que si es criterio: si esos grupos de verdad
         * llevan planes separados, o si conviene uno solo.
         */
        comoPartirlos: textoIa(
          200,
          "Si esos grupos de equipos iguales llevan de verdad un plan cada uno, o si conviene juntarlos en uno. Sin repetir el número: ese ya está contado.",
        ),
        frecuenciaSugerida: textoIa(90, "Cada cuanto, en lenguaje llano. «Mensual», «cada 500 horas»."),
        actividadesTipicas: z
          .array(textoIa(110, "Una actividad del preventivo, en imperativo."))
          .describe("Tres a seis, para que el usuario vea de que se trata. El detalle lo redacta después el generador de planes."),
      }),
    )
    .describe("De lo primero a lo último. Solo familias que vengan en los datos."),
  noTodavia: textoIa(
    300,
    "Que conviene NO planear todavía y por que. Null si no hay nada que dejar para después.",
  ).nullable(),
});

/**
 * Lo que sale a la pantalla: lo que dijo el modelo, mas el numero que puso el
 * codigo. Se juntan aqui para que la pantalla no tenga que sumar nada.
 */
export type ArranqueDePlanes = Omit<z.infer<typeof esquema>, "propuestas"> & {
  propuestas: Array<z.infer<typeof esquema>["propuestas"][number] & { planesQueFaltan: number }>;
};

export async function proponerArranque(
  org: OrgConIa,
  params: { userId?: string | null; operador?: boolean },
): Promise<{ ok: true; propuesta: ArranqueDePlanes; costoUsd: number } | { ok: false; motivo: string }> {
  const veredicto = await puedeUsarIa(org, "ARRANQUE_PLANES", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  const cobertura = await coberturaPreventiva(org.id);
  if (cobertura.sinPlan.length === 0) {
    return { ok: false, motivo: "Todos los equipos ya tienen al menos un plan. No hay nada que arrancar." };
  }

  // El correctivo por familia es el mejor indicio de por donde empezar: donde
  // mas se apaga fuego es donde falta preventivo. Se calcula aqui.
  const desde = new Date();
  desde.setMonth(desde.getMonth() - 12);
  const correctivas = await prisma.workOrder.findMany({
    where: {
      organizationId: org.id,
      maintenanceType: "CORRECTIVE",
      createdAt: { gte: desde },
      assetId: { not: null },
    },
    select: { asset: { select: { categoryId: true } }, totalCost: true, downtimeMinutes: true },
  });

  const porFamilia = new Map<string, { ordenes: number; costo: number; paroHoras: number }>();
  for (const o of correctivas) {
    const k = o.asset?.categoryId;
    if (!k) continue;
    const a = porFamilia.get(k) ?? { ordenes: 0, costo: 0, paroHoras: 0 };
    a.ordenes += 1;
    a.costo += o.totalCost;
    a.paroHoras += o.downtimeMinutes / 60;
    porFamilia.set(k, a);
  }

  // Cuantos planes faltan por familia: un grupo de equipos iguales sin plan es
  // un plan que falta. Sale del mismo calculo que el constructor, para que el
  // numero sea el mismo en las dos pantallas.
  const constructor = await constructorDePlanes(org.id);
  const gruposPorFamilia = new Map<string, number>();
  for (const g of constructor.grupos) {
    if (g.estado !== "SIN_PLAN") continue;
    gruposPorFamilia.set(g.categoria, (gruposPorFamilia.get(g.categoria) ?? 0) + 1);
  }

  const categorias = await prisma.assetCategory.findMany({
    where: { organizationId: org.id },
    select: {
      id: true, name: true,
      assets: {
        where: { active: true, status: { not: "RETIRED" } },
        select: {
          id: true, code: true, name: true, model: true, manufacturer: true, criticality: true,
          _count: { select: { planesAsignados: { where: { active: true } } } },
        },
      },
    },
  });

  const familias = categorias
    .map((c) => {
      const sinPlan = c.assets.filter((a) => a._count.planesAsignados === 0);
      const corr = porFamilia.get(c.id);
      return {
        familia: c.name,
        equipos: c.assets.length,
        sinPlan: sinPlan.length,
        // Lo cuenta el constructor, agrupando por fabricante y modelo. Es una
        // cuenta, no una opinion: el modelo no la recalcula.
        planesQueFaltan: gruposPorFamilia.get(c.name) ?? 0,
        criticos: sinPlan.filter((a) => a.criticality === "A").length,
        // Modelos distintos: la senal de que quiza haga falta mas de un plan.
        modelos: [...new Set(c.assets.map((a) => a.model).filter(Boolean))].slice(0, 8),
        ejemplos: sinPlan.slice(0, 4).map((a) => `${a.code} ${a.name}`),
        correctivoUltimoAno: corr
          ? { ordenes: corr.ordenes, costo: Math.round(corr.costo), paroHoras: Math.round(corr.paroHoras) }
          : { ordenes: 0, costo: 0, paroHoras: 0 },
      };
    })
    .filter((f) => f.sinPlan > 0)
    .sort((a, b) => b.sinPlan - a.sinPlan);

  if (!familias.length) {
    return { ok: false, motivo: "No hay familias de equipos sin plan que analizar." };
  }

  const resultado = await analizarConIa({
    organizationId: org.id,
    userId: params.userId ?? null,
    funcion: "ARRANQUE_PLANES",
    sistema:
      "Eres un jefe de mantenimiento que ha arrancado programas preventivos en varias plantas. " +
      "Te dan el catalogo de equipos de una empresa que apenas va a empezar, y dices por donde.\n\n" +
      "Reglas que no se rompen:\n" +
      "- Solo mencionas familias que vengan en los datos, con su nombre EXACTO.\n" +
      "- Los numeros ya vienen calculados. No los recalcules.\n" +
      "- El orden NO es por cantidad de equipos: se empieza por donde mas duele. Un correctivo caro " +
      "o un equipo critico pesan mas que veinte equipos sin historia.\n" +
      "- Cuantos planes faltan en cada familia YA ESTA CONTADO (planesQueFaltan): es el numero de grupos " +
      "de equipos iguales sin plan. No lo recalcules ni lo repitas como si fuera tuyo. En comoPartirlos " +
      "di si esos grupos llevan de verdad un plan cada uno —compresores tipo A y tipo B, si cambian " +
      "actividades o frecuencia— o si conviene juntarlos en uno.\n" +
      "- Las actividades que propongas son TIPICAS del tipo de equipo, no inventadas para impresionar. " +
      "Si no conoces el equipo, propon lo generico y dilo.\n" +
      "- Nada de torques, capacidades ni normas especificas: eso sale de la ficha del fabricante.\n" +
      "- Si conviene dejar familias para después, dilo en noTodavia. Arrancar con todo es como no arrancar.",
    instruccion:
      "Esta empresa tiene su catálogo de equipos cargado y le faltan planes preventivos. Dime por donde " +
      "empezar, en que orden y por que, y como estructurar cada familia.",
    contexto: {
      resumen: {
        equiposTotales: cobertura.totalActivos,
        conPlan: cobertura.conPlan,
        sinPlan: cobertura.sinPlan.length,
        planesQueFaltan: constructor.meta - constructor.construidos > 0 ? constructor.meta - constructor.construidos : 0,
        planesConstruidos: constructor.construidos,
      },
      comoLeerlo: {
        planesQueFaltan: "Cuantos planes faltan en esa familia, ya contado: un grupo de equipos iguales (misma marca y modelo) sin plan es un plan que falta. Es una cuenta, no una estimacion.",
        correctivoUltimoAno: "Órdenes correctivas de los últimos 12 meses en esa familia, con su costo y sus horas de paro. Donde mas se apaga fuego es donde mas falta preventivo.",
        modelos: "Modelos distintos dentro de la familia. Varios modelos suele significar que hace falta mas de un plan.",
        criticos: "Equipos de criticidad A sin plan. Son los que paran la producción.",
      },
      familias,
    },
    esquema,
    esfuerzo: "medium",
  });

  // Solo familias que existen: una inventada mandaria al usuario a buscar algo
  // que no esta en su catalogo.
  const nombres = new Set(familias.map((f) => f.familia));
  const propuesta: ArranqueDePlanes = {
    ...resultado.datos,
    propuestas: resultado.datos.propuestas
      .filter((p) => nombres.has(p.familia))
      .sort((a, b) => a.orden - b.orden)
      // El numero lo pone el codigo, no el modelo.
      .map((p) => ({ ...p, planesQueFaltan: gruposPorFamilia.get(p.familia) ?? 0 })),
  };

  return { ok: true, propuesta, costoUsd: resultado.costoUsd };
}
