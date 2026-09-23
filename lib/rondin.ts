import { prisma } from "./db";
import { normalizar } from "./busqueda";
import { siguienteFolio } from "./numbering";

/**
 * El rondin: el recorrido por la planta, con sus paradas.
 *
 * ── De donde de verdad se saca de que equipo se habla ──
 *
 * El codigo QR es lo mejor, pero hay que contar con que la planta no lo tenga
 * pegado. Por eso la identificacion es una cascada, de mas a menos confiable,
 * y la pregunta a la persona es el ULTIMO escalon y no el primero:
 *
 *   QR       el codigo del punto o del equipo. No hay duda.
 *   ELEGIDO  la persona lo dijo. Tampoco hay duda.
 *   PLACA    se leyo la placa del equipo en la foto.
 *   DICHO    se dedujo de lo que se dicto: «aqui en la bomba tres».
 *   AREA     no se sabe el equipo, pero si el area que se declaro al empezar.
 *   NINGUNO  no se sabe nada, y se dice.
 *
 * ── Por que NO se propone un candidato cuando hay dudas ──
 *
 * Porque proponer y pedir confirmacion se convierte en un tramite. Si el
 * sistema acierta cuatro de cada cinco veces, en tres dias la gente toca
 * «confirmar» sin leer, y el quinto entra igual —pero ahora con el sello de
 * que alguien lo reviso—.
 *
 * Asi que cuando hay base, no se pregunta. Y cuando no la hay, se pregunta EN
 * BLANCO: se ofrecen los candidatos sin ninguno marcado. Un desplegable vacio
 * obliga a pensar; uno con respuesta puesta invita a aceptarla.
 *
 * ── Por que «sin equipo» es una respuesta legitima ──
 *
 * Un hallazgo mal atribuido contamina el historial de ese equipo —su MTBF, su
 * costo, su Pareto— y eso no se nota nunca, porque el numero sigue viendose
 * bien. Uno sin equipo no daña nada: «charco de aceite en el pasillo de la
 * linea 2» sirve igual para que alguien vaya a verlo.
 *
 * Es la misma decision que `detieneLinea`, que es nulo a proposito: un hueco
 * visible vale mas que un dato inventado.
 */

export type ComoSeIdentifico = "QR" | "ELEGIDO" | "PLACA" | "DICHO" | "AREA" | "NINGUNO";

/**
 * Si se puede dar por bueno sin preguntar.
 *
 * `DICHO` NO es suficiente por si solo: la transcripcion se equivoca con los
 * nombres propios y con los numeros, que es justo de lo que estan hechos los
 * codigos de equipo. Se usa para PROPONER candidatos, no para decidir.
 */
export const SE_DA_POR_BUENO: ComoSeIdentifico[] = ["QR", "ELEGIDO", "PLACA"];

export function hayQuePreguntar(como: ComoSeIdentifico): boolean {
  return !SE_DA_POR_BUENO.includes(como);
}

/** Como se lee en pantalla, para que se vea de donde salio el dato. */
export const NOMBRE_IDENTIFICACION: Record<ComoSeIdentifico, string> = {
  QR: "Por su código QR",
  ELEGIDO: "Lo eligió usted",
  PLACA: "Leído de la placa",
  DICHO: "Deducido de lo que dijo",
  AREA: "Solo el área",
  NINGUNO: "Sin ubicar",
};

/**
 * Las palabras de relleno que estorban al buscar un equipo en lo dictado.
 *
 * «Aqui en la bomba tres traigo un ruido» tiene que buscar «bomba tres», no la
 * frase entera. Sin esto no coincidiria con nada y todas las paradas caerian
 * en preguntar, que es justo lo que se quiere evitar.
 */
const RELLENO = new Set([
  "aqui", "aca", "alla", "en", "el", "la", "los", "las", "un", "una", "de", "del",
  "y", "que", "con", "por", "para", "este", "esta", "estoy", "traigo", "trae",
  "tiene", "hay", "veo", "vemos", "se", "le", "lo", "al", "mi", "su", "es",
  "estamos", "sigo", "siguiente", "parada", "punto", "revisando", "checando",
]);

/** Los numeros dichos con letra, que es como se dictan. */
const NUMEROS: Record<string, string> = {
  uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5",
  seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
};

/**
 * Lo que de la frase dictada puede ser el nombre de un equipo.
 *
 * Devuelve las palabras utiles, con los numeros en cifra: «aqui en la bomba
 * tres» da ["bomba", "3"]. Se queda corto a proposito —no intenta entender la
 * frase— porque de aqui solo salen CANDIDATOS, y quien decide es quien mira.
 */
export function pistasDelDictado(dicho: string): string[] {
  return normalizar(dicho)
    .split(/\s+/)
    // Las cifras sueltas se quedan, aunque midan una letra. Esto empezo
    // filtrando por largo DESPUES de convertir «tres» en «3», y el 3 se caia
    // por corto: de «la bomba tres» quedaba «bomba», que coincide con todas
    // las bombas de la planta. Justo el dato que identifica al equipo era el
    // que se perdia, y en silencio.
    .filter((p) => (p.length > 1 || /^\d$/.test(p)) && !RELLENO.has(p))
    .map((p) => NUMEROS[p] ?? p)
    .slice(0, 6);
}

export type Identificacion = {
  assetId: string | null;
  reportPointId: string | null;
  locationId: string | null;
  como: ComoSeIdentifico;
  /** Para preguntar en blanco cuando no hay base. Vacio cuando no hace falta. */
  candidatos: Array<{ id: string; code: string; name: string; ubicacion: string | null }>;
  /** Como se le explica a quien lo ve. */
  explicacion: string;
};

/**
 * De que equipo o punto se trata esta parada.
 *
 * Siempre acotado a la empresa: el token de un QR dice a que organizacion
 * pertenece, y NUNCA se cree lo que venga del navegador.
 */
export async function identificarParada(
  organizationId: string,
  entrada: {
    tokenQr?: string | null;
    assetIdElegido?: string | null;
    dicho?: string | null;
    /** El area declarada al empezar el rondin. Acota la busqueda. */
    locationId?: string | null;
  },
): Promise<Identificacion> {
  const vacio = { assetId: null, reportPointId: null, locationId: entrada.locationId ?? null, candidatos: [] };

  // 1. Lo que la persona eligió. No hay nada más confiable.
  if (entrada.assetIdElegido) {
    const a = await prisma.asset.findFirst({
      where: { id: entrada.assetIdElegido, organizationId },
      select: { id: true, locationId: true },
    });
    if (a) {
      return { ...vacio, assetId: a.id, locationId: a.locationId ?? entrada.locationId ?? null,
        como: "ELEGIDO", explicacion: NOMBRE_IDENTIFICACION.ELEGIDO };
    }
  }

  // 2. El código QR del punto: trae su sitio, su ubicación y su equipo.
  if (entrada.tokenQr) {
    const punto = await prisma.reportPoint.findFirst({
      where: { token: entrada.tokenQr, organizationId, activo: true },
      select: { id: true, assetId: true, locationId: true, nombre: true },
    });
    if (punto) {
      return { ...vacio, reportPointId: punto.id, assetId: punto.assetId,
        locationId: punto.locationId ?? entrada.locationId ?? null,
        como: "QR", explicacion: `${NOMBRE_IDENTIFICACION.QR}: ${punto.nombre}` };
    }
  }

  // 3. Lo que se dictó, buscado DENTRO del área declarada.
  //
  //    Aquí es donde el área se gana su lugar: sin ella, «bomba 3» puede ser
  //    cualquiera de las cuatro bombas 3 de la planta; dentro de la línea 2 es
  //    una sola, y la parada se resuelve sin molestar a nadie.
  const pistas = entrada.dicho ? pistasDelDictado(entrada.dicho) : [];
  if (pistas.length) {
    const enElArea = entrada.locationId ? { locationId: entrada.locationId } : {};
    const equipos = await prisma.asset.findMany({
      where: { organizationId, active: true, ...enElArea },
      select: { id: true, code: true, name: true, location: { select: { name: true } } },
      take: 400,
    });
    const coinciden = equipos.filter((e) => {
      const texto = normalizar(`${e.code} ${e.name}`);
      return pistas.every((p) => texto.includes(p));
    });

    if (coinciden.length === 1) {
      const e = coinciden[0];
      return { ...vacio, assetId: e.id, como: "DICHO",
        candidatos: [],
        explicacion: `${NOMBRE_IDENTIFICACION.DICHO}: ${e.code} — ${e.name}` };
    }
    if (coinciden.length > 1 && coinciden.length <= 8) {
      // Varios: se ofrecen SIN elegir por la persona. Quedarse con el primero
      // seria una moneda al aire con el historial de un equipo de por medio.
      return {
        ...vacio,
        como: entrada.locationId ? "AREA" : "NINGUNO",
        candidatos: coinciden.map((e) => ({ id: e.id, code: e.code, name: e.name, ubicacion: e.location?.name ?? null })),
        explicacion: `Lo que dijo coincide con ${coinciden.length} equipos. ¿Cuál es?`,
      };
    }
  }

  // 4. Al menos el área, que ya sitúa el hallazgo.
  if (entrada.locationId) {
    return { ...vacio, como: "AREA", explicacion: NOMBRE_IDENTIFICACION.AREA };
  }
  return { ...vacio, como: "NINGUNO", explicacion: NOMBRE_IDENTIFICACION.NINGUNO };
}

/** El rondín que esta persona dejó a medias, si lo hay. */
export async function rondinEnCurso(organizationId: string, userId: string) {
  return prisma.rondin.findFirst({
    where: { organizationId, iniciadoPorId: userId, estado: "EN_CURSO" },
    orderBy: { iniciadoEn: "desc" },
    select: { id: true, numero: true, iniciadoEn: true, locationId: true, siteId: true,
      _count: { select: { paradas: true } } },
  });
}

/**
 * Empieza un recorrido.
 *
 * Si ya hay uno en curso de esta persona se devuelve ESE, no se crea otro. Un
 * rondín se interrumpe todo el tiempo —suena el teléfono, se cae la señal, se
 * bloquea la pantalla—, y volver a entrar tiene que continuar lo empezado. Con
 * dos abiertos, las paradas se repartirían entre los dos y ninguno contaría la
 * historia completa.
 */
export async function iniciarRondin(
  organizationId: string,
  userId: string,
  donde: { siteId?: string | null; locationId?: string | null } = {},
) {
  const abierto = await rondinEnCurso(organizationId, userId);
  if (abierto) return { rondin: abierto, reanudado: true };

  const numero = await siguienteFolio(organizationId, "rondin");
  const rondin = await prisma.rondin.create({
    data: {
      organizationId, numero, iniciadoPorId: userId,
      siteId: donde.siteId ?? null, locationId: donde.locationId ?? null,
    },
    select: { id: true, numero: true, iniciadoEn: true, locationId: true, siteId: true,
      _count: { select: { paradas: true } } },
  });
  return { rondin, reanudado: false };
}

/** Cierra el recorrido. Uno sin paradas se cancela: no hubo recorrido. */
export async function terminarRondin(organizationId: string, rondinId: string, nota?: string | null) {
  const r = await prisma.rondin.findFirst({
    where: { id: rondinId, organizationId },
    select: { id: true, estado: true, _count: { select: { paradas: true } } },
  });
  if (!r) return { ok: false as const, motivo: "El recorrido no existe." };
  if (r.estado !== "EN_CURSO") return { ok: false as const, motivo: "Ese recorrido ya estaba cerrado." };

  await prisma.rondin.update({
    where: { id: r.id },
    data: {
      estado: r._count.paradas > 0 ? "TERMINADO" : "CANCELADO",
      terminadoEn: new Date(),
      nota: nota?.trim() || null,
    },
  });
  return { ok: true as const, paradas: r._count.paradas, vacio: r._count.paradas === 0 };
}
