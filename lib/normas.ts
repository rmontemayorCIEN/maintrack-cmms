/**
 * Cumplimiento normativo: que norma sigue esta empresa y con que la cumple.
 *
 * Este modulo NO ejecuta nada. Lo que hace es llevar el INDICE: que pieza del
 * sistema —plan, vigencia, registro propio, rondin, orden— responde a cada
 * obligacion, y si esa pieza esta viva y al corriente. El trabajo lo siguen
 * haciendo los modulos de siempre.
 *
 * Tres criterios que no se negocian aqui:
 *
 * 1. **Una obligacion sin nada amarrado NO se cuenta como incumplida ni como
 *    cumplida.** Se dice que no se sabe. Contarla de cualquiera de los dos
 *    lados seria inventar, y en este tema inventar cuesta multas.
 * 2. **El estado de una obligacion es el PEOR de sus amarres.** Si una de las
 *    tres plantas trae el plan vencido, la obligacion no esta al corriente. Lo
 *    contrario —tomar el mejor— convertiria el modulo en una maquina de
 *    presumir cumplimiento.
 * 3. **No se calcula un porcentaje de cumplimiento.** Ver `resumirObligaciones`
 *    en `lib/normas-tipos.ts`: un «87% cumplido» es una cifra que se ve seria,
 *    que nadie puede reproducir y que se acaba presumiendo en una junta.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logAudit } from "./audit";
import { estadoDeVigencia } from "./vigencias-tipos";
import { NORMAS, normaDeCatalogo, normasParaGiro, type NormaDeCatalogo } from "./normas-catalogo";
import {
  PESO_ESTADO, definicionDeObligacion, esOrigenNorma, esTipoObligacion,
  resumirObligaciones, type EstadoObligacion, type PiezaDeCumplimiento,
} from "./normas-tipos";

export type Resultado<T> = { ok: true; dato: T } | { ok: false; motivos: string[] };

/** Cuantos dias antes de la fecha se considera «por vencer». */
const DIAS_DE_AVISO = 15;

// ─────────────────────────────────────────── Adoptar

/**
 * Las normas del catalogo que esta empresa todavia no adopta, propuestas por
 * su giro.
 *
 * Mismo mecanismo que los centros de costo sugeridos: el sistema ya sabe si es
 * planta, edificio u hospital, y propone lo que le toca. Un giro desconocido
 * ve el catalogo completo en vez de una lista vacia.
 */
export async function normasSugeridas(orgId: string, tipoInstalacion: string | null | undefined) {
  const adoptadas = new Set(
    (await prisma.normaAdoptada.findMany({ where: { organizationId: orgId }, select: { clave: true } })).map((n) => n.clave),
  );
  const suGiro = normasParaGiro(tipoInstalacion);
  return {
    delGiro: suGiro.filter((n) => !adoptadas.has(n.clave)),
    // Las demas se ofrecen aparte: que no sean tipicas de su giro no quiere
    // decir que no le apliquen, y esconderlas seria decidir por el cliente.
    otras: NORMAS.filter((n) => !adoptadas.has(n.clave) && !suGiro.some((x) => x.clave === n.clave)),
  };
}

/** Copia una norma del catalogo a esta empresa, con sus obligaciones. */
export async function adoptarDelCatalogo(orgId: string, clave: string, userId?: string | null): Promise<Resultado<{ id: string }>> {
  const norma = normaDeCatalogo(clave);
  if (!norma) return { ok: false, motivos: [`No existe «${clave}» en el catálogo.`] };

  const ya = await prisma.normaAdoptada.findFirst({ where: { organizationId: orgId, clave }, select: { id: true } });
  if (ya) return { ok: false, motivos: [`«${clave}» ya está en su lista.`] };

  const creada = await prisma.normaAdoptada.create({
    data: {
      organizationId: orgId,
      clave: norma.clave,
      titulo: norma.titulo,
      emisor: norma.emisor,
      resumen: norma.resumen,
      fueraDeAlcance: norma.fueraDeAlcance,
      origen: "CATALOGO",
      versionAdoptada: norma.version,
      obligaciones: {
        create: norma.obligaciones.map((o, i) => ({
          clave: o.clave, titulo: o.titulo, detalle: o.detalle, tipo: o.tipo,
          cadaDias: o.cadaDias ?? null, evidencia: o.evidencia, orden: i,
        })),
      },
    },
    select: { id: true },
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "CREATE",
    entity: "NormaAdoptada", entityId: creada.id,
    summary: `Adoptó ${norma.clave} — ${norma.titulo}`,
  });
  return { ok: true, dato: creada };
}

export type ObligacionNueva = {
  titulo: string;
  detalle?: string | null;
  tipo: string;
  cadaDias?: number | null;
  evidencia?: string | null;
};

/**
 * Una norma que define el cliente: un requisito corporativo, de su cliente, o
 * una norma que todavia no esta en nuestro catalogo.
 *
 * Nace con `origen: PROPIA`, y eso se muestra siempre: nadie la actualiza si el
 * requisito cambia, y el cliente tiene que saberlo.
 */
export async function crearNormaPropia(
  orgId: string,
  datos: { clave: string; titulo: string; emisor?: string | null; resumen?: string | null; obligaciones: ObligacionNueva[] },
  userId?: string | null,
): Promise<Resultado<{ id: string }>> {
  const motivos: string[] = [];
  const clave = datos.clave?.trim().toUpperCase();
  const titulo = datos.titulo?.trim();
  if (!clave) motivos.push("La norma necesita una clave, como la nombra su gente: «ISO 9001», «Estándar corporativo 14».");
  if (!titulo) motivos.push("La norma necesita título.");
  if (!datos.obligaciones?.length) motivos.push("Agregue al menos una obligación: sin obligaciones no hay nada que seguir.");

  for (const o of datos.obligaciones ?? []) {
    if (!o.titulo?.trim()) motivos.push("Hay una obligación sin título.");
    if (!esTipoObligacion(o.tipo)) motivos.push(`«${o.titulo}» tiene un tipo que no existe.`);
    if (o.cadaDias != null && (o.cadaDias < 1 || o.cadaDias > 3650)) {
      motivos.push(`El periodo de «${o.titulo}» tiene que estar entre 1 y 3650 días.`);
    }
  }

  if (clave) {
    const ya = await prisma.normaAdoptada.findFirst({ where: { organizationId: orgId, clave }, select: { id: true } });
    if (ya) motivos.push(`Ya tiene una norma con la clave «${clave}».`);
  }
  if (motivos.length) return { ok: false, motivos };

  const creada = await prisma.normaAdoptada.create({
    data: {
      organizationId: orgId,
      clave: clave!, titulo: titulo!,
      emisor: datos.emisor?.trim() || null,
      resumen: datos.resumen?.trim() || null,
      origen: "PROPIA",
      versionAdoptada: 0,
      obligaciones: {
        create: datos.obligaciones.map((o, i) => ({
          clave: `propia-${i + 1}`,
          titulo: o.titulo.trim(),
          detalle: o.detalle?.trim() || null,
          tipo: o.tipo,
          cadaDias: o.cadaDias ?? null,
          evidencia: o.evidencia?.trim() || null,
          orden: i,
        })),
      },
    },
    select: { id: true },
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "CREATE",
    entity: "NormaAdoptada", entityId: creada.id,
    summary: `Dio de alta la norma propia ${clave} — ${titulo}`,
  });
  return { ok: true, dato: creada };
}

// ─────────────────────────────────────────── Amarrar

const COLUMNA_DE_PIEZA: Record<PiezaDeCumplimiento, "planId" | "vigenciaId" | "tablaId" | "rondinId" | "ordenId"> = {
  plan: "planId", vigencia: "vigenciaId", tabla: "tablaId", rondin: "rondinId", orden: "ordenId",
};

/**
 * Comprueba que la pieza sea DE ESTA EMPRESA antes de amarrarla.
 *
 * El id llega del navegador. Sin esta revision se podria amarrar el plan de
 * otra cuenta y el semaforo leeria datos ajenos —una fuga con disfraz de
 * cumplimiento—.
 */
async function piezaDeLaEmpresa(orgId: string, pieza: PiezaDeCumplimiento, id: string): Promise<boolean> {
  const w = { id, organizationId: orgId };
  switch (pieza) {
    case "plan": return Boolean(await prisma.maintenancePlan.findFirst({ where: w, select: { id: true } }));
    case "vigencia": return Boolean(await prisma.vigencia.findFirst({ where: w, select: { id: true } }));
    case "tabla": return Boolean(await prisma.tablaPropia.findFirst({ where: w, select: { id: true } }));
    case "rondin": return Boolean(await prisma.rondin.findFirst({ where: w, select: { id: true } }));
    case "orden": return Boolean(await prisma.workOrder.findFirst({ where: w, select: { id: true } }));
  }
}

export async function amarrar(
  orgId: string,
  obligacionId: string,
  pieza: PiezaDeCumplimiento,
  piezaId: string,
  userId?: string | null,
): Promise<Resultado<{ id: string }>> {
  const obligacion = await prisma.obligacionAdoptada.findFirst({
    where: { id: obligacionId, norma: { organizationId: orgId } },
    select: { id: true, titulo: true, norma: { select: { clave: true } } },
  });
  if (!obligacion) return { ok: false, motivos: ["Esa obligación no existe en esta empresa."] };
  if (!(await piezaDeLaEmpresa(orgId, pieza, piezaId))) {
    return { ok: false, motivos: ["Lo que quiere amarrar no existe en esta empresa."] };
  }

  const columna = COLUMNA_DE_PIEZA[pieza];
  const repetido = await prisma.amarreDeCumplimiento.findFirst({
    where: { obligacionId, [columna]: piezaId }, select: { id: true },
  });
  if (repetido) return { ok: false, motivos: ["Eso ya está amarrado a esta obligación."] };

  const creado = await prisma.amarreDeCumplimiento.create({
    data: { organizationId: orgId, obligacionId, [columna]: piezaId },
    select: { id: true },
  });
  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "UPDATE",
    entity: "ObligacionAdoptada", entityId: obligacion.id,
    summary: `Amarró ${pieza} a «${obligacion.titulo}» de ${obligacion.norma.clave}`,
  });
  return { ok: true, dato: creado };
}

export async function desamarrar(orgId: string, amarreId: string, userId?: string | null): Promise<Resultado<{ id: string }>> {
  const amarre = await prisma.amarreDeCumplimiento.findFirst({
    where: { id: amarreId, organizationId: orgId },
    select: { id: true, obligacion: { select: { id: true, titulo: true } } },
  });
  if (!amarre) return { ok: false, motivos: ["Ese amarre no existe en esta empresa."] };
  await prisma.amarreDeCumplimiento.delete({ where: { id: amarre.id } });
  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "UPDATE",
    entity: "ObligacionAdoptada", entityId: amarre.obligacion.id,
    summary: `Quitó un respaldo de «${amarre.obligacion.titulo}»`,
  });
  return { ok: true, dato: { id: amarre.id } };
}

/**
 * Marca una obligacion como que no aplica, con su razon.
 *
 * La razon es obligatoria y no es burocracia: en una inspeccion preguntan por
 * que NO tiene algo, y «no tenemos recipientes sujetos a presion» escrito y
 * fechado es una respuesta. Un hueco sin explicar, no.
 */
export async function marcarNoAplica(
  orgId: string, obligacionId: string, razon: string, userId?: string | null,
): Promise<Resultado<{ id: string }>> {
  const texto = razon?.trim();
  if (!texto) return { ok: false, motivos: ["Escriba por qué no aplica: eso también es evidencia."] };

  const obligacion = await prisma.obligacionAdoptada.findFirst({
    where: { id: obligacionId, norma: { organizationId: orgId } }, select: { id: true, titulo: true },
  });
  if (!obligacion) return { ok: false, motivos: ["Esa obligación no existe en esta empresa."] };

  await prisma.obligacionAdoptada.update({
    where: { id: obligacion.id }, data: { aplica: false, razonNoAplica: texto },
  });
  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "UPDATE",
    entity: "ObligacionAdoptada", entityId: obligacion.id,
    summary: `Marcó «${obligacion.titulo}» como que no aplica: ${texto}`,
  });
  return { ok: true, dato: { id: obligacion.id } };
}

export async function marcarQueAplica(orgId: string, obligacionId: string, userId?: string | null): Promise<Resultado<{ id: string }>> {
  const obligacion = await prisma.obligacionAdoptada.findFirst({
    where: { id: obligacionId, norma: { organizationId: orgId } }, select: { id: true, titulo: true },
  });
  if (!obligacion) return { ok: false, motivos: ["Esa obligación no existe en esta empresa."] };
  await prisma.obligacionAdoptada.update({ where: { id: obligacion.id }, data: { aplica: true, razonNoAplica: null } });
  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "UPDATE",
    entity: "ObligacionAdoptada", entityId: obligacion.id,
    summary: `Volvió a considerar «${obligacion.titulo}»`,
  });
  return { ok: true, dato: { id: obligacion.id } };
}

// ─────────────────────────────────────────── El estado

/** Lo que se necesita saber de un amarre para juzgarlo. Lo arma `listarNormas`. */
export type AmarreJuzgable = {
  id: string;
  pieza: PiezaDeCumplimiento;
  /** Como se llama lo amarrado, para mostrarlo. */
  etiqueta: string;
  /** La liga a la pieza, para poder ir a verla. */
  href: string | null;
  estado: EstadoObligacion;
  /** Por que quedo en ese estado, en una linea. */
  porque: string;
};

const dias = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

/**
 * El estado de UN amarre.
 *
 * Cada pieza se juzga con el criterio que ya usa su propio modulo: la vigencia
 * con `estadoDeVigencia`, el plan con su proxima fecha. No se inventa un
 * criterio nuevo aqui —si dos pantallas responden la misma pregunta, la
 * respuesta tiene que vivir en un solo lugar—.
 */
export function estadoDeAmarre(
  a: {
    pieza: PiezaDeCumplimiento;
    planActivo?: boolean; planProxima?: Date | null;
    vigencia?: { tipo: string; hasta: Date | null; activa: boolean; avisarDias: number | null } | null;
    ultimaCaptura?: Date | null;
    rondinTerminado?: Date | null;
    ordenCerrada?: Date | null;
  },
  cadaDias: number | null | undefined,
  ahora = new Date(),
): { estado: EstadoObligacion; porque: string } {
  switch (a.pieza) {
    case "plan": {
      if (!a.planActivo) return { estado: "VENCIDA", porque: "El plan está apagado." };
      if (!a.planProxima) return { estado: "SIN_SABER", porque: "El plan no tiene próxima fecha programada." };
      const faltan = dias(a.planProxima, ahora);
      if (faltan < 0) return { estado: "VENCIDA", porque: `El plan venció hace ${Math.abs(faltan)} días.` };
      if (faltan <= DIAS_DE_AVISO) return { estado: "POR_VENCER", porque: `El plan vence en ${faltan} días.` };
      return { estado: "AL_CORRIENTE", porque: `Programado, vence en ${faltan} días.` };
    }
    case "vigencia": {
      if (!a.vigencia) return { estado: "SIN_SABER", porque: "El documento ya no está." };
      const e = estadoDeVigencia(a.vigencia, ahora);
      if (e === "VENCIDA") return { estado: "VENCIDA", porque: "El documento está vencido." };
      if (e === "POR_VENCER") return { estado: "POR_VENCER", porque: "El documento está por vencer." };
      if (e === "CANCELADA") return { estado: "VENCIDA", porque: "El documento fue cancelado." };
      // Un documento sin fecha de vencimiento es valido y no caduca.
      return { estado: "AL_CORRIENTE", porque: e === "SIN_VENCIMIENTO" ? "El documento no caduca." : "El documento está vigente." };
    }
    case "tabla": {
      if (!a.ultimaCaptura) return { estado: "VENCIDA", porque: "No hay nada capturado todavía." };
      if (!cadaDias) return { estado: "AL_CORRIENTE", porque: "Hay registros capturados." };
      const desde = dias(ahora, a.ultimaCaptura);
      if (desde > cadaDias) return { estado: "VENCIDA", porque: `El último registro es de hace ${desde} días y toca cada ${cadaDias}.` };
      if (desde > cadaDias - DIAS_DE_AVISO) return { estado: "POR_VENCER", porque: `Van ${desde} días desde el último registro.` };
      return { estado: "AL_CORRIENTE", porque: `Último registro hace ${desde} días.` };
    }
    case "rondin": {
      if (!a.rondinTerminado) return { estado: "SIN_SABER", porque: "Ese recorrido no se ha terminado." };
      if (!cadaDias) return { estado: "AL_CORRIENTE", porque: "El recorrido se hizo." };
      const desde = dias(ahora, a.rondinTerminado);
      return desde > cadaDias
        ? { estado: "VENCIDA", porque: `El recorrido es de hace ${desde} días y toca cada ${cadaDias}.` }
        : { estado: "AL_CORRIENTE", porque: `Recorrido hace ${desde} días.` };
    }
    case "orden": {
      if (!a.ordenCerrada) return { estado: "SIN_SABER", porque: "Esa orden todavía no se cierra." };
      if (!cadaDias) return { estado: "AL_CORRIENTE", porque: "La orden se cerró." };
      const desde = dias(ahora, a.ordenCerrada);
      return desde > cadaDias
        ? { estado: "VENCIDA", porque: `Se cerró hace ${desde} días y toca cada ${cadaDias}.` }
        : { estado: "AL_CORRIENTE", porque: `Cerrada hace ${desde} días.` };
    }
  }
}

/**
 * El estado de una obligacion a partir de sus amarres: el PEOR de todos.
 *
 * Si una de las tres plantas trae el plan vencido, la obligacion no esta al
 * corriente. Tomar el mejor convertiria esto en una maquina de presumir.
 */
export function estadoDeObligacion(
  obligacion: { aplica: boolean },
  amarres: Array<{ estado: EstadoObligacion }>,
): EstadoObligacion {
  if (!obligacion.aplica) return "NO_APLICA";
  if (!amarres.length) return "SIN_SABER";
  return amarres.map((a) => a.estado).sort((x, y) => PESO_ESTADO[x] - PESO_ESTADO[y])[0];
}

// ─────────────────────────────────────────── Leer

const INCLUIR_AMARRES = {
  plan: { select: { id: true, name: true, active: true, nextDueDate: true } },
  vigencia: { select: { id: true, titulo: true, tipo: true, hasta: true, activa: true, avisarDias: true } },
  tabla: { select: { id: true, nombre: true, clave: true } },
  rondin: { select: { id: true, numero: true, estado: true, terminadoEn: true } },
  orden: { select: { id: true, number: true, title: true, status: true, completedAt: true } },
};

export type ObligacionLeida = {
  id: string;
  clave: string;
  titulo: string;
  detalle: string | null;
  tipo: string;
  cadaDias: number | null;
  evidencia: string | null;
  aplica: boolean;
  razonNoAplica: string | null;
  responsable: string | null;
  amarres: AmarreJuzgable[];
  estado: EstadoObligacion;
};

export type NormaLeida = {
  id: string;
  clave: string;
  titulo: string;
  emisor: string | null;
  resumen: string | null;
  fueraDeAlcance: string | null;
  origen: string;
  versionAdoptada: number;
  activa: boolean;
  responsable: string | null;
  nota: string | null;
  /** Cierto cuando el catálogo ya va en una versión más nueva que la adoptada. */
  cambioDesdeQueLaAdopto: boolean;
  obligaciones: ObligacionLeida[];
  resumenEstado: ReturnType<typeof resumirObligaciones>;
};

/**
 * Las normas de la empresa con su estado ya calculado.
 *
 * La ultima captura de cada registro propio se consulta APARTE y en una sola
 * pasada, no dentro del recorrido: una consulta por obligacion convertiria una
 * pantalla en veinte viajes a la base.
 */
export async function listarNormas(orgId: string, ahora = new Date()): Promise<NormaLeida[]> {
  const filas = await prisma.normaAdoptada.findMany({
    where: { organizationId: orgId },
    orderBy: [{ activa: "desc" }, { clave: "asc" }],
    include: {
      responsable: { select: { name: true } },
      obligaciones: {
        orderBy: [{ orden: "asc" }, { createdAt: "asc" }],
        include: {
          responsable: { select: { name: true } },
          amarres: { include: INCLUIR_AMARRES },
        },
      },
    },
  });

  // Ultima captura por tabla propia amarrada, de un solo jalon.
  const tablaIds = [...new Set(filas.flatMap((n) => n.obligaciones.flatMap((o) => o.amarres.map((a) => a.tablaId).filter((x): x is string => Boolean(x)))))];
  const ultimas = new Map<string, Date>();
  if (tablaIds.length) {
    const agrupado = await prisma.renglonPropio.groupBy({
      by: ["tablaId"],
      where: { organizationId: orgId, tablaId: { in: tablaIds }, activo: true },
      _max: { createdAt: true },
    });
    for (const g of agrupado) if (g._max.createdAt) ultimas.set(g.tablaId, g._max.createdAt);
  }

  return filas.map((n) => {
    const delCatalogo = n.origen === "CATALOGO" ? normaDeCatalogo(n.clave) : null;
    const obligaciones = n.obligaciones.map((o) => {
      const amarres: AmarreJuzgable[] = o.amarres.map((a) => {
        if (a.plan) {
          const r = estadoDeAmarre({ pieza: "plan", planActivo: a.plan.active, planProxima: a.plan.nextDueDate }, o.cadaDias, ahora);
          return { id: a.id, pieza: "plan", etiqueta: a.plan.name, href: `/plans/${a.plan.id}`, ...r };
        }
        if (a.vigencia) {
          const r = estadoDeAmarre({ pieza: "vigencia", vigencia: a.vigencia }, o.cadaDias, ahora);
          return { id: a.id, pieza: "vigencia", etiqueta: a.vigencia.titulo, href: "/vigencias", ...r };
        }
        if (a.tabla) {
          const r = estadoDeAmarre({ pieza: "tabla", ultimaCaptura: ultimas.get(a.tabla.id) ?? null }, o.cadaDias, ahora);
          return { id: a.id, pieza: "tabla", etiqueta: a.tabla.nombre, href: `/registros/${a.tabla.clave}`, ...r };
        }
        if (a.rondin) {
          const r = estadoDeAmarre({ pieza: "rondin", rondinTerminado: a.rondin.terminadoEn }, o.cadaDias, ahora);
          return { id: a.id, pieza: "rondin", etiqueta: `Rondín ${a.rondin.numero}`, href: `/rondines/${a.rondin.id}`, ...r };
        }
        if (a.orden) {
          const r = estadoDeAmarre({ pieza: "orden", ordenCerrada: a.orden.completedAt }, o.cadaDias, ahora);
          return { id: a.id, pieza: "orden", etiqueta: `${a.orden.number} — ${a.orden.title}`, href: `/work-orders/${a.orden.id}`, ...r };
        }
        // Un amarre sin pieza es un renglon huerfano: se dice, no se esconde.
        return { id: a.id, pieza: "orden" as const, etiqueta: "—", href: null, estado: "SIN_SABER" as const, porque: "Lo que respaldaba esto ya no existe." };
      });

      return {
        id: o.id, clave: o.clave, titulo: o.titulo, detalle: o.detalle, tipo: o.tipo,
        cadaDias: o.cadaDias, evidencia: o.evidencia, aplica: o.aplica,
        razonNoAplica: o.razonNoAplica, responsable: o.responsable?.name ?? null,
        amarres, estado: estadoDeObligacion(o, amarres),
      };
    });

    return {
      id: n.id, clave: n.clave, titulo: n.titulo, emisor: n.emisor, resumen: n.resumen,
      fueraDeAlcance: n.fueraDeAlcance, origen: n.origen, versionAdoptada: n.versionAdoptada,
      activa: n.activa, responsable: n.responsable?.name ?? null, nota: n.nota,
      cambioDesdeQueLaAdopto: Boolean(delCatalogo && delCatalogo.version > n.versionAdoptada),
      obligaciones,
      resumenEstado: resumirObligaciones(obligaciones.map((o) => o.estado)),
    };
  });
}

export async function normaPorClave(orgId: string, clave: string, ahora = new Date()): Promise<NormaLeida | null> {
  const todas = await listarNormas(orgId, ahora);
  return todas.find((n) => n.clave === clave) ?? null;
}

/**
 * A que normas responde una orden de trabajo.
 *
 * Por su plan —lo normal, porque el plan es el que responde a la norma— y por
 * lo que se le haya amarrado directo. Es lo que se imprime en el papel: sin
 * eso, el indice de cumplimiento no le sirve al auditor, que lo que tiene
 * enfrente es la hoja.
 */
export async function normasDeLaOrden(orgId: string, ordenId: string): Promise<Array<{ clave: string; titulo: string }>> {
  const orden = await prisma.workOrder.findFirst({
    where: { id: ordenId, organizationId: orgId },
    select: { id: true, planId: true },
  });
  if (!orden) return [];

  const amarres = await prisma.amarreDeCumplimiento.findMany({
    where: {
      organizationId: orgId,
      OR: [{ ordenId: orden.id }, ...(orden.planId ? [{ planId: orden.planId }] : [])],
    },
    select: { obligacion: { select: { norma: { select: { clave: true, titulo: true, activa: true } } } } },
  });

  const vistas = new Map<string, { clave: string; titulo: string }>();
  for (const a of amarres) {
    const n = a.obligacion.norma;
    if (n.activa) vistas.set(n.clave, { clave: n.clave, titulo: n.titulo });
  }
  return [...vistas.values()].sort((a, b) => a.clave.localeCompare(b.clave, "es"));
}

/**
 * El expediente de una norma para una inspeccion: lo que se hizo y lo que lo
 * respalda, en un periodo.
 *
 * Trae lo REAL —ordenes cerradas, documentos vigentes, registros capturados—,
 * no un resumen. Lo que un inspector pide es la evidencia, no un tablero.
 */
export async function expedienteDeNorma(
  orgId: string,
  clave: string,
  periodo: { desde: Date; hasta: Date },
  ahora = new Date(),
) {
  const norma = await normaPorClave(orgId, clave, ahora);
  if (!norma) return null;

  const planIds: string[] = [];
  const tablaIds: string[] = [];
  const vigenciaIds: string[] = [];
  const rondinIds: string[] = [];
  const ordenIds: string[] = [];
  const amarres = await prisma.amarreDeCumplimiento.findMany({
    where: { organizationId: orgId, obligacion: { norma: { clave, organizationId: orgId } } },
    select: { planId: true, tablaId: true, vigenciaId: true, rondinId: true, ordenId: true },
  });
  for (const a of amarres) {
    if (a.planId) planIds.push(a.planId);
    if (a.tablaId) tablaIds.push(a.tablaId);
    if (a.vigenciaId) vigenciaIds.push(a.vigenciaId);
    if (a.rondinId) rondinIds.push(a.rondinId);
    if (a.ordenId) ordenIds.push(a.ordenId);
  }

  const [ordenes, documentos, registros, rondines] = await Promise.all([
    // Lo que de verdad se hizo: ordenes terminadas en el periodo, por plan o
    // amarradas directo.
    planIds.length || ordenIds.length
      ? prisma.workOrder.findMany({
          where: {
            organizationId: orgId,
            status: { in: ["COMPLETED", "CLOSED"] },
            completedAt: { gte: periodo.desde, lte: periodo.hasta },
            OR: [
              ...(planIds.length ? [{ planId: { in: planIds } }] : []),
              ...(ordenIds.length ? [{ id: { in: ordenIds } }] : []),
            ],
          },
          orderBy: { completedAt: "desc" },
          select: {
            id: true, number: true, title: true, completedAt: true,
            assignedTo: { select: { name: true } },
            asset: { select: { code: true, name: true } },
            _count: { select: { attachments: true } },
          },
        })
      : Promise.resolve([]),
    vigenciaIds.length
      ? prisma.vigencia.findMany({
          where: { organizationId: orgId, id: { in: vigenciaIds } },
          select: { id: true, titulo: true, tipo: true, folio: true, desde: true, hasta: true, activa: true, avisarDias: true },
        })
      : Promise.resolve([]),
    tablaIds.length
      ? prisma.renglonPropio.groupBy({
          by: ["tablaId"],
          where: { organizationId: orgId, tablaId: { in: tablaIds }, activo: true, createdAt: { gte: periodo.desde, lte: periodo.hasta } },
          _count: { _all: true },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    rondinIds.length
      ? prisma.rondin.findMany({
          where: { organizationId: orgId, id: { in: rondinIds } },
          select: { id: true, numero: true, estado: true, terminadoEn: true },
        })
      : Promise.resolve([]),
  ]);

  const nombresTablas = tablaIds.length
    ? await prisma.tablaPropia.findMany({ where: { organizationId: orgId, id: { in: tablaIds } }, select: { id: true, nombre: true } })
    : [];
  const porTabla = new Map(nombresTablas.map((t) => [t.id, t.nombre]));

  return {
    norma,
    periodo,
    ordenes,
    documentos: documentos.map((d) => ({ ...d, estado: estadoDeVigencia(d, ahora) })),
    registros: registros.map((r) => ({
      tabla: porTabla.get(r.tablaId) ?? "—",
      cuantos: r._count._all,
      ultimo: r._max.createdAt,
    })),
    rondines,
    /** Lo que quedó sin respaldo en el periodo. Se muestra: esconderlo sería el peor servicio. */
    sinRespaldo: norma.obligaciones.filter((o) => o.estado === "SIN_SABER").map((o) => o.titulo),
  };
}

/** Las normas cuyo contenido cambió desde que la empresa las adoptó. */
export async function normasQueCambiaron(orgId: string) {
  const adoptadas = await prisma.normaAdoptada.findMany({
    where: { organizationId: orgId, origen: "CATALOGO", activa: true },
    select: { id: true, clave: true, titulo: true, versionAdoptada: true },
  });
  return adoptadas
    .map((n) => ({ ...n, catalogo: normaDeCatalogo(n.clave) }))
    .filter((n) => n.catalogo && n.catalogo.version > n.versionAdoptada)
    .map((n) => ({ id: n.id, clave: n.clave, titulo: n.titulo, suya: n.versionAdoptada, nueva: n.catalogo!.version }));
}

/** Vuelve a copiar del catálogo una norma que cambió, conservando lo amarrado. */
export async function actualizarDesdeCatalogo(orgId: string, normaId: string, userId?: string | null): Promise<Resultado<{ nuevas: number; version: number }>> {
  const norma = await prisma.normaAdoptada.findFirst({
    where: { id: normaId, organizationId: orgId, origen: "CATALOGO" },
    include: { obligaciones: { select: { clave: true } } },
  });
  if (!norma) return { ok: false, motivos: ["Esa norma no existe en esta empresa, o no es del catálogo."] };

  const delCatalogo = normaDeCatalogo(norma.clave);
  if (!delCatalogo) return { ok: false, motivos: ["Esa norma ya no está en el catálogo."] };

  // Solo se AGREGA lo que falta. No se borra ni se pisa lo que el cliente ya
  // tiene amarrado o marcó como que no aplica: su trabajo no se tira porque
  // nosotros publicamos una versión.
  const tiene = new Set(norma.obligaciones.map((o) => o.clave));
  const faltantes = delCatalogo.obligaciones.filter((o) => !tiene.has(o.clave));

  await prisma.$transaction(async (tx) => {
    if (faltantes.length) {
      await tx.obligacionAdoptada.createMany({
        data: faltantes.map((o, i) => ({
          normaId: norma.id, clave: o.clave, titulo: o.titulo, detalle: o.detalle,
          tipo: o.tipo, cadaDias: o.cadaDias ?? null, evidencia: o.evidencia,
          orden: norma.obligaciones.length + i,
        })),
      });
    }
    await tx.normaAdoptada.update({
      where: { id: norma.id },
      data: {
        versionAdoptada: delCatalogo.version,
        titulo: delCatalogo.titulo,
        resumen: delCatalogo.resumen,
        fueraDeAlcance: delCatalogo.fueraDeAlcance,
      },
    });
  });

  await logAudit({
    organizationId: orgId, userId: userId ?? undefined, action: "UPDATE",
    entity: "NormaAdoptada", entityId: norma.id,
    summary: `Actualizó ${norma.clave} a la versión ${delCatalogo.version}${faltantes.length ? `, con ${faltantes.length} obligaciones nuevas` : ""}`,
  });
  return { ok: true, dato: { nuevas: faltantes.length, version: delCatalogo.version } };
}
