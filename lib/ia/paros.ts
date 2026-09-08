import { z } from "zod";
import { prisma } from "../db";
import { analizarConIa, textoIa } from "./cliente";
import { puedeUsarIa, type OrgConIa } from "./consumo";
import { contextoDeLaEmpresa } from "../contexto-negocio";
import { costoDeParar, ventanas, PERIODOS, type ClavePeriodo } from "../costo-de-parar";

/**
 * Por que para un area, contado para la direccion.
 *
 * ── Por que una funcion nueva y no una que ya existe ──
 *
 * `DIAGNOSTICO` es de toda la operacion, semanal y de todos los temas: no
 * recibe area ni periodo. `RECURRENCIA` es de UN equipo y no puede ver lo que
 * conecta a varios. Lo que falta es lo de en medio: un area, un periodo, y en
 * dinero.
 *
 * ── Lo que esta puede hacer y ninguna otra ──
 *
 * Es la primera que tiene a la vez las cifras de perdida y lo que el dueno
 * declaro de su negocio. Con las dos cosas puede decir si lo que a el le
 * preocupa y lo que los numeros senalan son lo mismo —y cuando no lo son, eso
 * es el hallazgo—.
 *
 * Ninguna cifra la calcula el modelo. Llegan resueltas de `costoDeParar` y su
 * trabajo es unicamente leer el texto de las ordenes.
 */

const SISTEMA = `Eres un ingeniero de confiabilidad explicandole a un DUENO —no a un jefe de mantenimiento— por que se detuvo un area de su planta.

Le entregan las cifras YA CALCULADAS —horas de paro, cuanto costo, que equipo aporto cuanto— y el texto de las ordenes de trabajo: que se reporto y que hizo el tecnico. Tambien, si existe, lo que el dueno declaro de su negocio.

Como trabaja:

1. NO recalcule ni corrija las cifras. Su aporte es lo que el texto dice y los numeros no.
2. Hable en el idioma de quien firma los cheques. Nada de MTBF ni disponibilidad: horas, pesos, entregas y riesgo.
3. Busque lo que CONECTA a los equipos del area, aunque cada tecnico lo haya escrito distinto. Que dos maquinas fallen por aire humedo es un hallazgo; que cada una falle por lo suyo tambien lo es, y hay que decirlo.
4. Un equipo que para OCHO veces cuesta mas que uno que para el doble de horas en dos ocasiones: cada arranque tiene su costo y su riesgo. Fijese en la frecuencia, no solo en el total.
5. Si lo que el dueno declaro NO coincide con lo que dicen los numeros, digalo. Que crea que su problema es uno y los datos senalen otro es el hallazgo mas valioso que le puede dar. Si coincide, confirmelo con la cifra.
6. Cite folios. Una conclusion sin folios que la sostengan no convence a nadie.
7. Si las resoluciones estan vacias o dicen "listo" y nada mas, digalo y baje la confianza. Es preferible admitir que el expediente no alcanza a inventar una causa que mande a desarmar un equipo sano.
8. No invente torques, normas, capacidades ni marcas. Si no lo sabe, no lo diga.`;

const Esquema = z.object({
  explicacion: textoIa(
    600,
    "Que esta pasando de verdad en esta area, en dos o tres frases, para un dueno. Empiece por lo que mas cuesta. Cite folios entre parentesis.",
  ),
  loQueConecta: textoIa(
    400,
    "El hilo comun entre los equipos que fallaron, si lo hay: misma causa, mismo origen, mismo descuido. Si cada uno fallo por lo suyo, dígalo con esas palabras en vez de forzar un patron.",
  ).nullable(),
  contraLoQueDijo: textoIa(
    400,
    "Si la empresa declaro que algo no puede parar o que le duele algo en particular, diga si los numeros lo confirman o lo contradicen, con la cifra. Nulo si la empresa no declaro nada.",
  ).nullable(),
  accion: z.object({
    titulo: textoIa(180, "Lo primero que conviene hacer, en imperativo y concreto."),
    porque: textoIa(300, "Que se gana. Use la cifra de perdida del area o del equipo."),
    quien: z.enum(["MANTENIMIENTO", "COMPRAS", "PRODUCCION", "DIRECCION"]).describe(
      "A quien le toca. DIRECCION solo cuando requiere autorizar dinero o cambiar como se opera.",
    ),
  }),
  confianza: z.enum(["ALTA", "MEDIA", "BAJA"]).describe(
    "BAJA si las ordenes no explican por que fallo. MEDIA si hay indicios. ALTA solo si el texto sostiene la conclusion.",
  ),
});

export type AnalisisDeParos = z.infer<typeof Esquema>;

/** Cuantas ordenes del area se le dan a leer. Mas que esto no aporta y cuesta. */
const ORDENES_MAXIMAS = 40;

export async function explicarParos(
  org: OrgConIa,
  params: {
    locationId: string | null;
    periodo: ClavePeriodo;
    /** Ventana exacta, cuando el director la delimito arrastrando el dedo. */
    rango?: { desde: Date; hasta: Date } | null;
    userId?: string | null;
    operador?: boolean;
  },
): Promise<
  | { ok: true; analisis: AnalisisDeParos; area: string; costoUsd: number }
  | { ok: false; motivo: string }
> {
  const veredicto = await puedeUsarIa(org, "PARO_AREA", { operador: params.operador });
  if (!veredicto.permitido) return { ok: false, motivo: veredicto.motivo };

  /**
   * La ventana que el usuario delimito manda sobre el periodo del boton.
   *
   * Es la diferencia entre preguntar por "los ultimos 90 dias" y preguntar por
   * "esas tres semanas de julio en las que algo paso". Lo segundo es lo que
   * ningun tablero deja hacer, y es donde esta el valor.
   */
  const v = ventanas(params.periodo);
  const rango = params.rango ?? v.actual;
  const resumen = await costoDeParar(org.id, rango);
  const area = resumen.areas.find((a) => a.locationId === params.locationId);

  /**
   * Negarse bien es parte de la funcion.
   *
   * Sin paros no hay nada que explicar, y gastar una operacion de la bolsa del
   * cliente para que el modelo diga "no hay datos" es cobrarle por nada.
   */
  if (!area) {
    return { ok: false, motivo: "Esa área no registró paros en el periodo, así que no hay nada que explicar." };
  }
  if (area.horasQueDetienen === 0 && area.horasQueNoDetienen === 0) {
    return { ok: false, motivo: `${area.area} no registró paros en ${PERIODOS[params.periodo].etiqueta.toLowerCase()}.` };
  }

  const equiposDelArea = area.equipos.map((e) => e.assetId);

  const ordenes = await prisma.workOrder.findMany({
    where: {
      organizationId: org.id,
      assetId: { in: equiposDelArea },
      OR: [
        { startedAt: { gte: rango.desde, lte: rango.hasta } },
        { completedAt: { gte: rango.desde, lte: rango.hasta } },
      ],
    },
    orderBy: { completedAt: "desc" },
    take: ORDENES_MAXIMAS,
    select: {
      number: true, title: true, description: true, resolution: true,
      maintenanceType: true, downtimeMinutes: true, totalCost: true,
      completedAt: true,
      asset: { select: { code: true, name: true } },
      failureCode: { select: { code: true, description: true } },
      rootCause: { select: { code: true, description: true } },
    },
  });

  if (!ordenes.length) {
    return {
      ok: false,
      motivo: `Hay horas de paro registradas en ${area.area}, pero ninguna orden de trabajo del periodo que las explique. Sin ese texto no hay nada que leer.`,
    };
  }

  const dia = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  const rotulo = params.rango
    ? `el tramo del ${dia(rango.desde)} al ${dia(rango.hasta)}`
    : PERIODOS[params.periodo].etiqueta.toLowerCase();

  const empresa = await prisma.organization.findUniqueOrThrow({
    where: { id: org.id },
    select: {
      tipoInstalacion: true, industry: true, queProduce: true, comoOpera: true,
      noPuedeParar: true, dueleHoy: true, objetivoDelAno: true, contextoAt: true,
    },
  });

  const r = await analizarConIa({
    organizationId: org.id,
    userId: params.userId,
    funcion: "PARO_AREA",
    sistema: SISTEMA,
    esquema: Esquema,
    instruccion:
      `Explique por que se detuvo el area "${area.area}" en ${rotulo}, ` +
      "leyendo el texto de las ordenes. Empiece por lo que mas costo.",
    contexto: {
      empresa: contextoDeLaEmpresa(empresa),
      area: {
        nombre: area.area,
        periodo: rotulo,
        margenPorHoraDetenida: area.margenPorHora || null,
        horasQueDetuvieronProduccion: area.horasQueDetienen,
        horasDeEquiposQueNoDetienen: area.horasQueNoDetienen,
        horasDeMantenimientoPlaneado: area.horasPlaneadas,
        perdida: area.perdida,
      },
      /**
       * El desglose por equipo incluye CUANTAS VECES paro, no solo las horas.
       * Es la diferencia entre "se descompuso" y "se descompone", y el modelo
       * no puede deducirla del total.
       */
      equipos: area.equipos.map((e) => ({
        codigo: e.code,
        nombre: e.name,
        detieneProduccion: e.detieneLinea,
        horas: e.horas,
        veces: ordenes.filter((o) => o.asset?.code === e.code).length,
        perdida: e.perdida,
      })),
      contextoDeLaPlanta: {
        perdidaDeTodaLaPlanta: resumen.perdida,
        estaAreaEsEl:
          resumen.perdida > 0
            ? `${Math.round((area.perdida / resumen.perdida) * 100)}% de la pérdida total`
            : null,
      },
      ordenes: ordenes.map((o) => ({
        folio: o.number,
        equipo: o.asset ? `${o.asset.code} — ${o.asset.name}` : null,
        tipo: o.maintenanceType,
        titulo: o.title,
        seReporto: o.description,
        queSeHizo: o.resolution,
        modoDeFalla: o.failureCode ? `${o.failureCode.code} — ${o.failureCode.description}` : null,
        causaRaiz: o.rootCause ? `${o.rootCause.code} — ${o.rootCause.description}` : null,
        minutosDeParo: o.downtimeMinutes,
        costo: o.totalCost,
        cerrada: o.completedAt?.toISOString().slice(0, 10) ?? null,
      })),
    },
  });

  return { ok: true, analisis: r.datos, area: area.area, costoUsd: r.costoUsd };
}
