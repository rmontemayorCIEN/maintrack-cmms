import { prisma } from "../db";
import { iaDeLaOrganizacion } from "../planes";
import { FUNCIONES_IA, type ClaveFuncionIA } from "./funciones";
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
  let operaciones = 0, costo = 0, tokens = 0, fallidas = 0;

  for (const r of registros) {
    operaciones += r.operaciones;
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
    operaciones,
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

  const { operaciones } = await consumoIa(org.id);
  const restantes = entitlement.operaciones - operaciones;
  if (restantes < definicion.operaciones) {
    return {
      permitido: false,
      motivoCorto: "AGOTADO",
      motivo: `Se agotaron las operaciones de IA de este mes (${entitlement.operaciones}). Se renuevan el dia 1, o puede ampliarlas con el complemento IA Avanzada.`,
    };
  }

  return { permitido: true, restantes };
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
