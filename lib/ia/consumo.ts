import { prisma } from "../db";
import { iaDeLaOrganizacion } from "../planes";
import { FUNCIONES_IA, tieneBolsaPropia, type ClaveConBolsa, type ClaveFuncionIA } from "./funciones";
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
    if (!tieneBolsaPropia(r.funcion)) delPlan += r.operaciones;
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
 * Las bolsas propias: cuanto cabe y que decir cuando se acaba.
 *
 * ── Por que un solo bloque y no uno por funcion ──
 *
 * Eran dos copias casi identicas —la ayuda y el parte del dia— y al llegar el
 * dictado iban a ser tres. Tres copias de la misma decision es como se
 * desincronizan: la del medio se corrige y las otras se quedan. El criterio
 * vive aqui una sola vez, y el tipo obliga a que cada funcion con bolsa
 * propia tenga su mensaje.
 *
 * ── Por que cada mensaje dice algo distinto ──
 *
 * Porque lo que le queda a la persona es distinto en cada caso, y eso es lo
 * unico que de verdad le importa cuando se topa con un limite. «Se agoto» a
 * secas deja a alguien parado sin saber que hacer; decirle con que sigue
 * trabajando, no.
 */
const AL_AGOTARSE: Record<ClaveConBolsa, (cupo: number) => string> = {
  AYUDA: (cupo) =>
    `Se agotaron las preguntas de ayuda de este mes (${cupo}). Se renuevan el dia 1. La ayuda escrita de cada pantalla sigue disponible sin limite.`,
  BRIEF: (cupo) =>
    `Se agotaron los partes del dia de este mes (${cupo}). Se renuevan el dia 1. Lo que dice el parte sigue en el inicio, escrito.`,
  NAVEGAR: (cupo) =>
    `Se agotaron los comandos de voz de este mes (${cupo}). Se renuevan el dia 1. El menu y la busqueda siguen igual.`,
  DICTADO: (cupo) =>
    `Se agotaron los dictados de este mes (${cupo}). Se renuevan el dia 1. Puede escribir el cierre a mano, y la codificacion con IA sigue funcionando igual.`,
};

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

  if (tieneBolsaPropia(funcion)) {
    const cupo = entitlement.bolsas[funcion];
    const usadas = await prisma.aiUsage.count({
      where: { organizationId: org.id, funcion, periodo: periodoActual(), ok: true },
    });
    const quedan = cupo - usadas;
    if (quedan <= 0) {
      return { permitido: false, motivoCorto: "AGOTADO", motivo: AL_AGOTARSE[funcion](cupo) };
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

/**
 * Lo que costo oir. Sirve para el dictado y para los comandos de voz.
 *
 * Lleva `funcion` porque son dos bolsas distintas y tienen que serlo: el
 * tecnico que dicta cierres no puede quedarse sin poder navegar, ni al reves.
 * Era una funcion sola para el dictado y al llegar la navegacion iba a ser la
 * segunda copia.
 *
 * Gemelo de `registrarVoz`, con una diferencia que importa: esto SI consume
 * bolsa —la suya, no la del plan—, asi que el registro no es solo
 * contabilidad, es lo que cuenta `puedeUsarIa`. Si no se guarda, el cupo no
 * baja nunca.
 *
 * `segundos` son los que Google dice que facturo, no los que duro la
 * grabacion ni los que el navegador reporto. Es la unica cifra que coincide
 * con el recibo, y contar por nuestra cuenta seria inventar un numero preciso
 * que no cuadra con nada.
 *
 * Viaja en `inputTokens`, el mismo prestamo de campo que usa la voz para los
 * caracteres, por no pedir una migracion para esto.
 *
 * Un audio que no se entendio se guarda con `ok: false`: cuesta igual —Google
 * ya escucho— pero no se le descuenta al cliente. Cobrarle el ruido de la
 * planta seria cobrarle por nada.
 */
export async function registrarEscucha(datos: {
  organizationId: string;
  userId?: string | null;
  funcion: "DICTADO" | "NAVEGAR";
  segundos: number;
  costoUsd: number;
  ok: boolean;
  /**
   * Que se dijo, cuando no se pudo con ello.
   *
   * Solo se guarda en el caso fallido, y es lo que despues dice si hacen falta
   * mas formas de pedir las cosas o si de plano conviene un modelo de
   * respaldo. Sin esto, «no le entendi» seria un callejon sin salida: nadie
   * sabria nunca QUE fue lo que no se entendio.
   */
  noSeEntendio?: string | null;
}) {
  try {
    await prisma.aiUsage.create({
      data: {
        organizationId: datos.organizationId,
        userId: datos.userId ?? null,
        funcion: datos.funcion,
        modelo: "speech-v2",
        inputTokens: Math.round(datos.segundos),
        operaciones: datos.ok ? FUNCIONES_IA[datos.funcion].operaciones : 0,
        costoUsd: datos.costoUsd,
        periodo: periodoActual(),
        ok: datos.ok,
        error: datos.ok ? null : (datos.noSeEntendio ?? null)?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    // Mismo criterio que la voz: una empresa de prueba que ya no existe no
    // vale un grito. Lo demas si se reporta.
    const codigo = (error as { code?: string })?.code;
    if (codigo !== "P2003") console.error("No se pudo registrar lo que se oyo:", error);
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
