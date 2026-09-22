import { prisma } from "../db";
import { iaDeLaOrganizacion } from "../planes";
import { CON_BOLSA_PROPIA, FUNCIONES_IA, type ClaveFuncionIA } from "./funciones";
import { costoUsd, type UsoTokens } from "./precios";

/**
 * Control de consumo de IA por organizacion.
 *
 * Dos contadores conviven aqui y no hay que confundirlos:
 *
 *   operaciones — lo que se le descuenta al cliente de la bolsa de su plan.
 *                 Es la unidad comercial y la que ve en pantalla.
 *   costoUsd    — lo que nos cuesta a nosotros ante Anthropic. Es la unidad
 *                 de operacion y solo la ve el operador de la plataforma.
 *
 * El limite se revisa ANTES de llamar al modelo. Una vez hecha la llamada el
 * gasto ya ocurrio, asi que el registro se guarda incluso si el modelo falla:
 * un error tambien se paga.
 */

export function periodoActual(fecha = new Date()) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

export type OrgConIa = {
  id: string;
  plan: string;
  iaComplemento: boolean;
  iaExtra: number;
};

/** Consumo del periodo: operaciones gastadas, costo real y desglose. */
export async function consumoIa(organizationId: string, periodo = periodoActual()) {
  const registros = await prisma.aiUsage.findMany({
    where: { organizationId, periodo },
    select: {
      funcion: true, operaciones: true, costoUsd: true, ok: true,
      inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true,
    },
  });

  const porFuncion = new Map<string, { operaciones: number; costoUsd: number; llamadas: number }>();
  let operaciones = 0, delPlan = 0, costo = 0, tokens = 0, fallidas = 0;

  for (const r of registros) {
    operaciones += r.operaciones;
    // Lo que tiene bolsa propia no gasta ademas la del plan. Antes sumaba en
    // las dos: la ayuda no se validaba contra la bolsa del plan —eso estaba
    // bien— pero si se la iba consumiendo, que es justo lo que su comentario
    // dice que no debia pasar.
    if (!CON_BOLSA_PROPIA.includes(r.funcion as ClaveFuncionIA)) delPlan += r.operaciones;
    costo += r.costoUsd;
    tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    if (!r.ok) fallidas += 1;
    const previo = porFuncion.get(r.funcion) ?? { operaciones: 0, costoUsd: 0, llamadas: 0 };
    porFuncion.set(r.funcion, {
      operaciones: previo.operaciones + r.operaciones,
      costoUsd: previo.costoUsd + r.costoUsd,
      llamadas: previo.llamadas + 1,
    });
  }

  return {
    periodo,
    /** Todo lo consumido, para enseñar el uso y el costo. */
    operaciones,
    /** Lo que descuenta de la bolsa del plan: sin lo que tiene bolsa aparte. */
    operacionesDelPlan: delPlan,
    costoUsd: costo,
    tokens,
    llamadas: registros.length,
    fallidas,
    porFuncion: [...porFuncion.entries()].map(([funcion, v]) => ({ funcion, ...v })),
  };
}

export type Veredicto =
  | { permitido: true; restantes: number }
  | { permitido: false; motivo: string; motivoCorto: "SIN_PLAN" | "AGOTADO" | "NO_DISPONIBLE" };

/**
 * Revisa plan, disponibilidad de la funcion y bolsa restante.
 *
 * `operador` es el operador de la plataforma trabajando dentro de la empresa
 * de un cliente. Se salta el plan y la bolsa a proposito: la implementacion se
 * vende como servicio y se ejecuta en cuentas de cualquier nivel, incluso
 * antes de que el cliente elija plan. El consumo SI queda registrado, para que
 * el costo de cada implementacion se vea en la consola.
 */
export async function puedeUsarIa(
  org: OrgConIa,
  funcion: ClaveFuncionIA,
  opciones: { operador?: boolean } = {},
): Promise<Veredicto> {
  const definicion = FUNCIONES_IA[funcion];
  if (!definicion.disponible) {
    return { permitido: false, motivoCorto: "NO_DISPONIBLE", motivo: `${definicion.nombre} aun no esta disponible.` };
  }
  if (opciones.operador) return { permitido: true, restantes: Infinity };

  const entitlement = iaDeLaOrganizacion(org);
  if (!entitlement.funciones.includes(funcion)) {
    return {
      permitido: false,
      motivoCorto: "SIN_PLAN",
      motivo: `Su plan no incluye ${definicion.nombre.toLowerCase()}. Se activa con el complemento IA Avanzada.`,
    };
  }

  // La ayuda tiene su propia bolsa y su propio conteo: si compartiera la del
  // plan, una cuenta que gasto sus operaciones en levantamientos se quedaria
  // sin poder preguntar como se usa el sistema.
  if (funcion === "AYUDA") {
    const usadas = await prisma.aiUsage.count({
      where: { organizationId: org.id, funcion: "AYUDA", periodo: periodoActual(), ok: true },
    });
    const quedan = entitlement.operacionesAyuda - usadas;
    if (quedan <= 0) {
      return {
        permitido: false,
        motivoCorto: "AGOTADO",
        motivo: `Se agotaron las preguntas de ayuda de este mes (${entitlement.operacionesAyuda}). Se renuevan el dia 1. La ayuda escrita de cada pantalla sigue disponible sin limite.`,
      };
    }
    return { permitido: true, restantes: quedan };
  }

  /**
   * El parte del dia tambien tiene bolsa propia, por el mismo motivo que la
   * ayuda y con mas razon.
   *
   * Se escucha a diario y se regenera cuando cambian los datos: medido en
   * produccion, tres veces por dia de uso, unas 66 al mes. La bolsa de
   * Professional son 20, asi que compartiendo se agotaba en una semana y el
   * director se encontraba con «se agotaron las operaciones» en la funcion que
   * mas se presume.
   *
   * Y es la funcion mas barata que hay: 0.0092 dolares por llamada, nueve
   * veces menos que una pregunta de ayuda. Racionarla para que compita con
   * levantamientos y procedimientos —diez veces mas caros— no tenia sentido.
   */
  if (funcion === "BRIEF") {
    const usadas = await prisma.aiUsage.count({
      where: { organizationId: org.id, funcion: "BRIEF", periodo: periodoActual(), ok: true },
    });
    const quedan = entitlement.operacionesBrief - usadas;
    if (quedan <= 0) {
      return {
        permitido: false,
        motivoCorto: "AGOTADO",
        motivo: `Se agotaron los partes del dia de este mes (${entitlement.operacionesBrief}). Se renuevan el dia 1. Lo que dice el parte sigue en el inicio, escrito.`,
      };
    }
    return { permitido: true, restantes: quedan };
  }

  const { operacionesDelPlan } = await consumoIa(org.id);
  const restantes = entitlement.operaciones - operacionesDelPlan;
  if (restantes < definicion.operaciones) {
    return {
      permitido: false,
      motivoCorto: "AGOTADO",
      motivo: `Se agotaron las operaciones de IA de este mes (${entitlement.operaciones}). Se renuevan el dia 1, o puede ampliarlas con el complemento IA Avanzada.`,
    };
  }

  return { permitido: true, restantes };
}

/**
 * Lo que costo hablar.
 *
 * La sintesis de voz no es una «funcion de IA» del catalogo —no se vende
 * aparte ni consume operaciones del plan, porque es barata y cobrarla por
 * operacion haria que probar doce voces gastara doce—. Pero SI cuesta dinero,
 * y lo que no se mide no se puede frenar: sin este registro, el primer aviso
 * de que alguien se emociono con el modo voz llegaria en la factura de
 * Google.
 *
 * Se guarda en la misma tabla que lo demas para que el consumo se vea en un
 * solo lugar, con `funcion: "VOZ"` y cero operaciones. En `inputTokens` van
 * los CARACTERES sintetizados, que es la unidad en la que Google cobra: es un
 * prestamo de campo, a proposito, para no pedir una migracion por esto.
 */
export async function registrarVoz(datos: {
  organizationId: string;
  userId?: string | null;
  voz: string;
  caracteres: number;
  costoUsd: number;
}) {
  try {
    await prisma.aiUsage.create({
      data: {
        organizationId: datos.organizationId,
        userId: datos.userId ?? null,
        funcion: "VOZ",
        modelo: datos.voz,
        inputTokens: Math.round(datos.caracteres),
        operaciones: 0,
        costoUsd: datos.costoUsd,
        periodo: periodoActual(),
        ok: true,
      },
    });
  } catch (error) {
    // Una empresa que ya no existe —o una de prueba— no es un problema que
    // valga la pena gritar: el audio ya se entrego. Lo demas si se reporta.
    const codigo = (error as { code?: string })?.code;
    if (codigo !== "P2003") console.error("No se pudo registrar el consumo de voz:", error);
  }
}

/** Guarda un consumo ya ocurrido. Nunca lanza: perder el registro seria peor. */
export async function registrarConsumo(datos: {
  organizationId: string;
  userId?: string | null;
  funcion: ClaveFuncionIA;
  modelo: string;
  uso: UsoTokens;
  ok: boolean;
  error?: string | null;
}) {
  const costo = costoUsd(datos.modelo, datos.uso);
  try {
    await prisma.aiUsage.create({
      data: {
        organizationId: datos.organizationId,
        userId: datos.userId ?? null,
        funcion: datos.funcion,
        modelo: datos.modelo,
        inputTokens: Math.round(datos.uso.entrada),
        outputTokens: Math.round(datos.uso.salida),
        cacheReadTokens: Math.round(datos.uso.cacheLectura ?? 0),
        cacheWriteTokens: Math.round(datos.uso.cacheEscritura ?? 0),
        // Una llamada fallida no consume bolsa del cliente, pero si cuesta.
        operaciones: datos.ok ? FUNCIONES_IA[datos.funcion].operaciones : 0,
        costoUsd: costo,
        periodo: periodoActual(),
        ok: datos.ok,
        error: datos.error ?? null,
      },
    });
  } catch (error) {
    console.error("No se pudo registrar el consumo de IA:", error);
  }
  return costo;
}

/** Consumo de todas las organizaciones en un periodo. Para la consola. */
export async function consumoPorOrganizacion(periodo = periodoActual()) {
  const filas = await prisma.aiUsage.groupBy({
    by: ["organizationId"],
    where: { periodo },
    _sum: { operaciones: true, costoUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  return new Map(
    filas.map((f) => [
      f.organizationId,
      {
        operaciones: f._sum.operaciones ?? 0,
        costoUsd: f._sum.costoUsd ?? 0,
        tokens: (f._sum.inputTokens ?? 0) + (f._sum.outputTokens ?? 0),
        llamadas: f._count._all,
      },
    ]),
  );
}
