/**
 * Herramientas: prestar, devolver y dar de baja.
 *
 * ── Las dos reglas que no se rompen
 *
 * 1. **Prestar y devolver NO tocan la existencia.** Mueven posesión, no valor.
 *    `PartStock.quantity` sigue siendo lo que la empresa posee y lo que cambia
 *    es `enResguardo`. Si el préstamo bajara la existencia tendría que pasar
 *    por `aplicarMovimiento()` —el único punto que mueve stock— y entonces
 *    cada devolución entraría al kardex como una entrada, ensuciando el costo
 *    promedio ponderado de todo el almacén.
 *
 * 2. **Dar de baja SÍ toca la existencia, y pasa por `aplicarMovimiento()`.**
 *    Perdida, robada, rota sin arreglo: eso es salida real y valuada. De ahí
 *    sale el reporte que hace valer el módulo —lo perdido, en dinero, por
 *    persona— y por eso no puede calcularse por fuera del kardex.
 *
 * Quien venga a cambiar esto: la tentación es «bajar la existencia al prestar
 * para que el almacén cuadre físicamente». El almacén cuadra igual —lo
 * prestado está en `enResguardo` y el conteo lo considera— y a cambio el costo
 * de todo el inventario deja de ser confiable.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ErrorDeAlmacen, aplicarMovimiento } from "./almacen";
import { logAudit, notify } from "./audit";
import {
  DIAS_PARA_AVISAR, diasFuera, disponible, esEstadoHerramienta, esMotivoBaja,
  modoDeAlmacen, regresoPeor, seLeAtribuye,
} from "./herramientas-tipos";

export type Resultado<T> = { ok: true; dato: T } | { ok: false; motivo: string; codigo?: number };

const falla = (motivo: string, codigo = 409): Resultado<never> => ({ ok: false, motivo, codigo });

// ─────────────────────────────────────────── Prestar

export type Prestamo = {
  organizationId: string;
  partId: string;
  warehouseId: string;
  /** Quien se la lleva y responde por ella. */
  personaId: string;
  cantidad?: number;
  /** Quien la entrega. Nulo en autoservicio: ahí la registra quien la toma. */
  entregadoPorId?: string | null;
  estadoSalida?: string | null;
  proposito?: string | null;
  nota?: string | null;
};

/**
 * Presta una herramienta.
 *
 * Todo en una transacción: un resguardo sin su `enResguardo` actualizado deja
 * disponible algo que ya se llevaron, y dos personas se pelearían la misma
 * pieza sin que el sistema lo notara.
 */
export async function prestar(p: Prestamo): Promise<Resultado<{ id: string }>> {
  const cantidad = p.cantidad ?? 1;
  if (!Number.isFinite(cantidad) || cantidad <= 0) return falla("La cantidad tiene que ser mayor que cero.", 400);
  if (p.estadoSalida && !esEstadoHerramienta(p.estadoSalida)) return falla("Ese estado de salida no existe.", 400);

  const [articulo, almacen, persona] = await Promise.all([
    prisma.part.findFirst({
      where: { id: p.partId, organizationId: p.organizationId },
      select: { id: true, code: true, name: true, naturaleza: true, active: true },
    }),
    prisma.warehouse.findFirst({
      where: { id: p.warehouseId, organizationId: p.organizationId },
      select: { id: true, name: true, autoservicio: true, active: true },
    }),
    prisma.user.findFirst({
      where: { id: p.personaId, organizationId: p.organizationId },
      select: { id: true, name: true, active: true },
    }),
  ]);

  if (!articulo) return falla("Esa herramienta no existe en esta empresa.", 404);
  if (!almacen) return falla("Ese almacén no existe en esta empresa.", 404);
  if (!persona) return falla("Esa persona no es de esta empresa.", 404);
  if (articulo.naturaleza !== "HERRAMIENTA") {
    return falla(`«${articulo.name}» está dado de alta como refacción, no como herramienta: una refacción se consume, no se presta.`, 422);
  }
  if (!articulo.active) return falla(`«${articulo.name}» está dada de baja del catálogo.`);
  if (!persona.active) return falla(`${persona.name} ya no está activo en la empresa.`);

  // Quien entrega también tiene que ser de esta empresa: el id llega del
  // navegador. En autoservicio no hay segunda firma y eso es correcto.
  if (p.entregadoPorId) {
    const quien = await prisma.user.findFirst({
      where: { id: p.entregadoPorId, organizationId: p.organizationId }, select: { id: true },
    });
    if (!quien) return falla("Quien entrega no es de esta empresa.", 404);
  } else if (modoDeAlmacen(almacen) === "MOSTRADOR") {
    return falla(`«${almacen.name}» entrega con almacenista: hay que registrar quién la entregó.`, 422);
  }

  const existencia = await prisma.partStock.findUnique({
    where: { partId_warehouseId: { partId: p.partId, warehouseId: p.warehouseId } },
    select: { quantity: true, enResguardo: true },
  });
  const libre = disponible(existencia?.quantity ?? 0, existencia?.enResguardo ?? 0);
  if (libre < cantidad) {
    return falla(
      libre === 0
        ? `No hay ${articulo.name} disponible en ${almacen.name}: todo lo que hay está prestado.`
        : `Solo hay ${libre} disponible de ${articulo.name} en ${almacen.name}; está pidiendo ${cantidad}.`,
    );
  }

  const creado = await prisma.$transaction(async (tx) => {
    /*
     * Se vuelve a leer DENTRO de la transacción y se condiciona el update: si
     * alguien ganó la carrera por la última pieza entre la revisión de arriba
     * y esto, el incremento no aplica y se avisa en vez de dejar dos personas
     * con la misma herramienta.
     */
    const actual = await tx.partStock.findUnique({
      where: { partId_warehouseId: { partId: p.partId, warehouseId: p.warehouseId } },
      select: { id: true, quantity: true, enResguardo: true },
    });
    if (!actual || disponible(actual.quantity, actual.enResguardo) < cantidad) {
      throw new ErrorDeAlmacen("Alguien tomó la última mientras registraba. Vuelva a intentar.");
    }
    await tx.partStock.update({
      where: { id: actual.id },
      data: { enResguardo: { increment: cantidad } },
    });
    return tx.resguardo.create({
      data: {
        organizationId: p.organizationId,
        partId: p.partId,
        warehouseId: p.warehouseId,
        personaId: p.personaId,
        cantidad,
        entregadoPorId: p.entregadoPorId ?? null,
        estadoSalida: p.estadoSalida ?? null,
        proposito: p.proposito?.trim() || null,
        nota: p.nota?.trim() || null,
      },
      select: { id: true },
    });
  });

  await logAudit({
    organizationId: p.organizationId,
    userId: p.entregadoPorId ?? p.personaId,
    action: "CREATE", entity: "Resguardo", entityId: creado.id,
    summary: `${persona.name} se llevó ${cantidad} ${articulo.code} — ${articulo.name}`,
  });
  return { ok: true, dato: creado };
}

// ─────────────────────────────────────────── Devolver

export type Devolucion = {
  organizationId: string;
  resguardoId: string;
  recibidoPorId?: string | null;
  estadoRegreso?: string | null;
  nota?: string | null;
};

/** Cierra un resguardo: la herramienta volvió al almacén. */
export async function devolver(d: Devolucion): Promise<Resultado<{ id: string; regresoPeor: boolean }>> {
  if (d.estadoRegreso && !esEstadoHerramienta(d.estadoRegreso)) return falla("Ese estado de regreso no existe.", 400);

  const resguardo = await prisma.resguardo.findFirst({
    where: { id: d.resguardoId, organizationId: d.organizationId },
    select: {
      id: true, partId: true, warehouseId: true, cantidad: true, devueltoEl: true,
      estadoSalida: true, personaId: true,
      part: { select: { code: true, name: true } },
      persona: { select: { name: true } },
    },
  });
  if (!resguardo) return falla("Ese resguardo no existe en esta empresa.", 404);
  if (resguardo.devueltoEl) return falla("Esa herramienta ya se había devuelto.");

  if (d.recibidoPorId) {
    const quien = await prisma.user.findFirst({
      where: { id: d.recibidoPorId, organizationId: d.organizationId }, select: { id: true },
    });
    if (!quien) return falla("Quien recibe no es de esta empresa.", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.resguardo.update({
      where: { id: resguardo.id },
      data: {
        devueltoEl: new Date(),
        recibidoPorId: d.recibidoPorId ?? null,
        estadoRegreso: d.estadoRegreso ?? null,
        nota: d.nota?.trim() || undefined,
      },
    });
    // Vuelve a estar disponible. La existencia no se toca: nunca bajó.
    await tx.partStock.updateMany({
      where: { partId: resguardo.partId, warehouseId: resguardo.warehouseId },
      data: { enResguardo: { decrement: resguardo.cantidad } },
    });
  });

  const peor = regresoPeor(resguardo.estadoSalida, d.estadoRegreso);
  await logAudit({
    organizationId: d.organizationId, userId: d.recibidoPorId ?? undefined,
    action: "UPDATE", entity: "Resguardo", entityId: resguardo.id,
    summary: `${resguardo.persona.name} devolvió ${resguardo.cantidad} ${resguardo.part.code}${peor ? " (regresó peor de como salió)" : ""}`,
  });
  return { ok: true, dato: { id: resguardo.id, regresoPeor: peor } };
}

// ─────────────────────────────────────────── Dar de baja

export type Baja = {
  organizationId: string;
  resguardoId?: string | null;
  /** Para dar de baja algo que está EN el almacén, sin resguardo de por medio. */
  partId?: string | null;
  warehouseId?: string | null;
  cantidad?: number;
  motivo: string;
  nota?: string | null;
  userId?: string | null;
};

/**
 * Da de baja una herramienta: se perdió, se la robaron, se rompió sin arreglo.
 *
 * ESTO SÍ pasa por `aplicarMovimiento()`: es salida real y valuada, y es la
 * única forma de que el costo de lo perdido sea el mismo número que usa el
 * resto del almacén. Calcularlo aquí por fuera daría una cifra que no cuadra
 * con el kardex, que es exactamente el tipo de número que nadie puede defender
 * en una junta.
 */
export async function darDeBaja(b: Baja): Promise<Resultado<{ costo: number }>> {
  if (!esMotivoBaja(b.motivo)) return falla("Ese motivo de baja no existe.", 400);

  let partId = b.partId ?? null;
  let warehouseId = b.warehouseId ?? null;
  let cantidad = b.cantidad ?? 1;
  let resguardo: { id: string; personaId: string; cantidad: number; part: { code: string; name: string }; persona: { name: string } } | null = null;

  if (b.resguardoId) {
    const r = await prisma.resguardo.findFirst({
      where: { id: b.resguardoId, organizationId: b.organizationId },
      select: {
        id: true, partId: true, warehouseId: true, cantidad: true, devueltoEl: true, personaId: true,
        part: { select: { code: true, name: true } }, persona: { select: { name: true } },
      },
    });
    if (!r) return falla("Ese resguardo no existe en esta empresa.", 404);
    if (r.devueltoEl) return falla("Esa herramienta ya se había devuelto: si se perdió después, dele de baja desde el almacén.");
    partId = r.partId;
    warehouseId = r.warehouseId;
    cantidad = b.cantidad ?? r.cantidad;
    if (cantidad > r.cantidad) return falla(`Ese resguardo es de ${r.cantidad}; no se pueden dar de baja ${cantidad}.`);
    resguardo = r;
  }

  if (!partId || !warehouseId) return falla("Falta decir qué herramienta y de qué almacén.", 400);

  const articulo = await prisma.part.findFirst({
    where: { id: partId, organizationId: b.organizationId },
    select: { id: true, code: true, name: true, naturaleza: true, unitCost: true },
  });
  if (!articulo) return falla("Esa herramienta no existe en esta empresa.", 404);

  const costo = await prisma.$transaction(async (tx) => {
    if (resguardo) {
      await tx.resguardo.update({
        where: { id: resguardo.id },
        data: { devueltoEl: new Date(), motivoBaja: b.motivo, nota: b.nota?.trim() || undefined },
      });
      // Deja de estar «fuera»: ahora ya no existe.
      await tx.partStock.updateMany({
        where: { partId, warehouseId },
        data: { enResguardo: { decrement: cantidad } },
      });
    }
    /*
     * La salida real. `DANO_O_PERDIDA` es el motivo que el almacén ya conoce;
     * el motivo fino de la herramienta queda en el resguardo y en la
     * referencia, para no inventar un catálogo paralelo de motivos.
     */
    await aplicarMovimiento({
      organizationId: b.organizationId,
      partId, warehouseId,
      tipo: "OUT",
      cantidad,
      motivo: "DANO_O_PERDIDA",
      referencia: `Baja de herramienta: ${b.motivo}${resguardo ? ` (la traía ${resguardo.persona.name})` : ""}`,
      entregadoA: resguardo?.personaId ?? null,
      userId: b.userId ?? null,
    }, tx as unknown as Prisma.TransactionClient);

    return articulo.unitCost * cantidad;
  });

  await logAudit({
    organizationId: b.organizationId, userId: b.userId ?? undefined,
    action: "DELETE", entity: "Resguardo", entityId: resguardo?.id ?? articulo.id,
    summary: `Baja de ${cantidad} ${articulo.code} — ${articulo.name}: ${b.motivo}${resguardo ? ` (la traía ${resguardo.persona.name})` : ""}`,
    changes: { motivo: b.motivo, cantidad, costo },
  });
  return { ok: true, dato: { costo } };
}

// ─────────────────────────────────────────── Consultar

/** Lo que está fuera ahora mismo, lo más viejo primero. */
export async function loQueEstaFuera(
  organizationId: string,
  opciones: { personaId?: string; ahora?: Date } = {},
) {
  const ahora = opciones.ahora ?? new Date();
  const filas = await prisma.resguardo.findMany({
    where: {
      organizationId,
      devueltoEl: null,
      ...(opciones.personaId ? { personaId: opciones.personaId } : {}),
    },
    orderBy: { entregadoEl: "asc" },
    include: {
      part: { select: { id: true, code: true, name: true, unit: true, unitCost: true } },
      persona: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      entregadoPor: { select: { name: true } },
    },
  });

  return filas.map((r) => ({
    ...r,
    dias: diasFuera(r.entregadoEl, ahora),
    /** Lo que lleva demasiado tiempo fuera: es lo que hay que ir a buscar. */
    seTardo: diasFuera(r.entregadoEl, ahora) >= DIAS_PARA_AVISAR,
  }));
}

/** Qué trae cada persona, para saber a quién preguntarle. */
export async function quienTraeQue(organizationId: string, ahora = new Date()) {
  const fuera = await loQueEstaFuera(organizationId, { ahora });
  const porPersona = new Map<string, { persona: { id: string; name: string }; piezas: number; valor: number; masViejo: number; cosas: typeof fuera }>();

  for (const r of fuera) {
    const actual = porPersona.get(r.personaId) ?? {
      persona: r.persona, piezas: 0, valor: 0, masViejo: 0, cosas: [] as typeof fuera,
    };
    actual.piezas += r.cantidad;
    actual.valor += r.cantidad * r.part.unitCost;
    actual.masViejo = Math.max(actual.masViejo, r.dias);
    actual.cosas.push(r);
    porPersona.set(r.personaId, actual);
  }

  // Quien trae lo más viejo primero: es a quien hay que ir a buscar.
  return [...porPersona.values()].sort((a, b) => b.masViejo - a.masViejo);
}

/**
 * Lo que se perdió, en dinero y por persona.
 *
 * **Este es el reporte que vende el módulo.** Sin él, esto es un inventario
 * más; con él, es una decisión de negocio: «a Pedro se le pierden los
 * calibradores de 50 mil».
 *
 * Solo cuenta las bajas que SE LE ATRIBUYEN a quien la traía —perdida,
 * dañada—, no el fin de vida útil ni lo que dejó de usarse. Meter ahí una
 * herramienta que duró ocho años sería acusar a alguien del desgaste normal,
 * y un reporte que acusa mal deja de usarse a la segunda vez.
 *
 * El costo sale del `unitCost` de la refacción, que es el costo promedio
 * ponderado que lleva el almacén: el mismo número que usa todo lo demás.
 */
export async function perdidasPorPersona(
  organizationId: string,
  opciones: { desde?: Date; hasta?: Date } = {},
) {
  const desde = opciones.desde ?? new Date(Date.now() - 365 * 86_400_000);
  const hasta = opciones.hasta ?? new Date();

  const bajas = await prisma.resguardo.findMany({
    where: {
      organizationId,
      motivoBaja: { not: null },
      devueltoEl: { gte: desde, lte: hasta },
    },
    include: {
      part: { select: { id: true, code: true, name: true, unitCost: true } },
      persona: { select: { id: true, name: true } },
    },
    orderBy: { devueltoEl: "desc" },
  });

  const atribuibles = bajas.filter((b) => seLeAtribuye(b.motivoBaja!));

  const porPersona = new Map<string, {
    persona: { id: string; name: string };
    piezas: number; costo: number;
    porHerramienta: Map<string, { code: string; name: string; piezas: number; costo: number }>;
  }>();

  for (const b of atribuibles) {
    const costo = b.cantidad * b.part.unitCost;
    const actual = porPersona.get(b.personaId) ?? {
      persona: b.persona, piezas: 0, costo: 0, porHerramienta: new Map(),
    };
    actual.piezas += b.cantidad;
    actual.costo += costo;
    const h = actual.porHerramienta.get(b.partId) ?? { code: b.part.code, name: b.part.name, piezas: 0, costo: 0 };
    h.piezas += b.cantidad;
    h.costo += costo;
    actual.porHerramienta.set(b.partId, h);
    porPersona.set(b.personaId, actual);
  }

  const personas = [...porPersona.values()]
    .map((p) => ({
      ...p,
      /** Lo que más se le pierde: el renglón que contesta «qué le pasa a Pedro». */
      herramientas: [...p.porHerramienta.values()].sort((a, b) => b.costo - a.costo),
    }))
    .sort((a, b) => b.costo - a.costo);

  return {
    periodo: { desde, hasta },
    personas,
    /** Total atribuido. Lo NO atribuible se informa aparte, no se esconde ni se suma. */
    costoTotal: personas.reduce((a, p) => a + p.costo, 0),
    piezasTotal: personas.reduce((a, p) => a + p.piezas, 0),
    /*
     * El desgaste normal se reporta por separado. Sumarlo al total de pérdidas
     * inflaría la cifra con algo que nadie hizo mal, y restarlo del todo
     * escondería que la herramienta se está acabando.
     */
    porDesgaste: bajas.filter((b) => !seLeAtribuye(b.motivoBaja!)).reduce(
      (a, b) => ({ piezas: a.piezas + b.cantidad, costo: a.costo + b.cantidad * b.part.unitCost }),
      { piezas: 0, costo: 0 },
    ),
  };
}

/** El panorama del almacén de herramientas: qué hay, qué está fuera, qué falta. */
export async function panoramaDeHerramientas(organizationId: string, ahora = new Date()) {
  const [articulos, fuera] = await Promise.all([
    prisma.part.findMany({
      where: { organizationId, naturaleza: "HERRAMIENTA", active: true },
      select: {
        id: true, code: true, name: true, unit: true, unitCost: true, quantityOnHand: true,
        existencias: { select: { warehouseId: true, quantity: true, enResguardo: true, warehouse: { select: { name: true, autoservicio: true } } } },
      },
      orderBy: { code: "asc" },
    }),
    loQueEstaFuera(organizationId, { ahora }),
  ]);

  const filas = articulos.map((a) => {
    const total = a.existencias.reduce((s, x) => s + x.quantity, 0);
    const prestadas = a.existencias.reduce((s, x) => s + x.enResguardo, 0);
    return {
      ...a,
      total,
      prestadas,
      libres: disponible(total, prestadas),
      valor: total * a.unitCost,
    };
  });

  return {
    filas,
    fuera,
    cuantas: filas.length,
    valorTotal: filas.reduce((a, f) => a + f.valor, 0),
    prestadas: fuera.reduce((a, r) => a + r.cantidad, 0),
    atrasadas: fuera.filter((r) => r.seTardo).length,
  };
}

/**
 * Avisa de lo que lleva demasiado tiempo fuera.
 *
 * Es la defensa del autoservicio: ahí la salida se registra sola —la persona
 * quiere la herramienta— pero la devolución la confirma nadie, y el sistema
 * acaba creyendo que Pedro trae el calibrador desde hace ocho meses cuando lo
 * devolvió en marzo.
 *
 * Sale por `notify()`, como todo lo que el sistema le dice a alguien: así gana
 * de golpe el aviso al celular y lo que se enchufe después.
 */
export async function avisarDeLoNoDevuelto(organizationId: string, ahora = new Date()) {
  const fuera = await loQueEstaFuera(organizationId, { ahora });
  const atrasadas = fuera.filter((r) => r.seTardo);
  if (!atrasadas.length) return { avisados: 0, piezas: 0 };

  const responsables = await prisma.warehouse.findMany({
    where: { organizationId, id: { in: [...new Set(atrasadas.map((r) => r.warehouseId))] } },
    select: { id: true, name: true, responsableId: true },
  });

  let avisados = 0;
  for (const almacen of responsables) {
    if (!almacen.responsableId) continue;
    const suyas = atrasadas.filter((r) => r.warehouseId === almacen.id);
    if (!suyas.length) continue;

    await notify({
      organizationId,
      userId: almacen.responsableId,
      title: `${suyas.length} ${suyas.length === 1 ? "herramienta lleva" : "herramientas llevan"} más de ${DIAS_PARA_AVISAR} días fuera`,
      body: suyas
        .slice(0, 5)
        .map((r) => `${r.part.code} — ${r.persona.name}, ${r.dias} días`)
        .join("; "),
      link: "/inventory/herramientas",
      modulo: "ALMACEN",
      // Se agrupan por almacén: tres herramientas atrasadas del mismo almacén
      // son un aviso, no tres apilados en el celular.
      tag: `herramientas-fuera-${almacen.id}`,
    });
    avisados++;
  }
  return { avisados, piezas: atrasadas.length };
}
