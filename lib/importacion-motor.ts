/**
 * El recorrido de una importación: validar, decidir, guardar todo o nada.
 *
 * Lo llaman la ruta y las pruebas —la MISMA función—, así que lo que se prueba
 * es lo que corre en producción.
 *
 * Las reglas, en el orden en que importan:
 *
 *  1. **Validar no escribe.** La vista previa lee la base para saber qué existe,
 *     y nada más. Se puede validar veinte veces el mismo archivo sin dejar rastro
 *     en los datos —sí en la bitácora, que es para eso—.
 *  2. **Con errores no se importa.** Si un renglón tiene un problema, se dice en
 *     qué fila y en qué columna, y se pide corregir el archivo. Importar «lo que
 *     sí se pudo» dejaba la mitad arriba y la otra mitad en el aire: una planta
 *     sin la mitad de sus equipos se ve completa y no lo está.
 *  3. **Todo o nada.** La escritura va en UNA transacción. Si a la mitad falla
 *     algo —una restricción, una caída—, no queda nada: ni los registros ya
 *     creados, ni relaciones rotas.
 *  4. **Los duplicados se deciden, no se adivinan.** Un duplicado exacto —misma
 *     clave— se omite o se actualiza, según se elija. Uno probable —otro código,
 *     pero mismo nombre en el mismo lugar, mismo número de serie, mismo RFC— se
 *     omite salvo que alguien diga expresamente «créalo». Nunca se combinan dos
 *     registros por parecido.
 *  5. **Cada importación es un lote.** Quién, cuándo, qué archivo —su huella,
 *     no su contenido—, qué creó y qué actualizó. Es lo que permite revisarla y,
 *     si hace falta, revertirla (`lib/lotes.ts`).
 */
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { leerCsv } from "./csv";
import { logAudit } from "./audit";
import { verificarCupo } from "./planes";
import { ZONA_POR_OMISION } from "./periodos";
import {
  IMPORTACIONES, type ClaveImportacion, type Comparable, type Existente, type Falla,
} from "./importacion";

export const LIMITE_FILAS = 5000;

export type EstadoFila =
  | "nuevo"        // se va a crear
  | "actualizar"   // existe y se eligió actualizarlo
  | "exacto"       // existe con la misma clave: se omite
  | "posible"      // se parece a uno existente: se omite salvo decisión
  | "error";       // no se puede importar tal cual

export type FilaAnalizada = {
  fila: number;
  estado: EstadoFila;
  resumen: string;
  clave?: string;
  fallas: Falla[];
  advertencias: Falla[];
  /** Con qué registro coincide, y por qué. */
  coincide?: { id: string | null; resumen: string; motivo: string };
};

export type Decisiones = {
  /** Qué hacer con los duplicados exactos. */
  exactos: "omitir" | "actualizar";
  /** Filas de posibles duplicados que el usuario pidió crear de todos modos. */
  crearPosibles: number[];
};

export const DECISIONES_POR_OMISION: Decisiones = { exactos: "omitir", crearPosibles: [] };

export type Analisis = {
  filas: FilaAnalizada[];
  totales: {
    leidos: number; nuevos: number; actualizar: number; exactos: number;
    posibles: number; errores: number; advertencias: number;
  };
  columnasDesconocidas: string[];
  puedeImportar: boolean;
};

export class ErrorDeImportacion extends Error {
  constructor(message: string, readonly codigo = 422) {
    super(message);
  }
}

/** Por qué dos registros parecen el mismo. Nulo si no se parecen. */
function parecido(a: Comparable, b: Comparable): string | null {
  if (a.serie && b.serie && a.serie === b.serie) return "mismo número de serie";
  if (a.rfc && b.rfc && a.rfc === b.rfc) return "mismo RFC";
  if (a.correo && b.correo && a.correo === b.correo) return "mismo correo";
  if (a.firma && b.firma && a.firma === b.firma) return "mismo equipo y misma frecuencia";
  if (a.nombre && b.nombre && a.nombre === b.nombre && (a.ambito ?? "") === (b.ambito ?? "")) {
    return a.ambito ? "mismo nombre en la misma ubicación" : "mismo nombre";
  }
  return null;
}

async function zonaDe(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || ZONA_POR_OMISION;
}

/**
 * Lee el archivo y dice qué pasaría con cada renglón. NO escribe nada.
 *
 * Devuelve también los datos listos para guardar, para que la ejecución no
 * tenga que volver a convertir; pero la ejecución vuelve a llamar a esta
 * función, sobre la base de ese momento, y no confía en una vista previa
 * vieja.
 */
export async function analizarImportacion(p: {
  tipo: ClaveImportacion;
  contenido: string;
  organizationId: string;
  decisiones?: Decisiones;
}): Promise<Analisis & { _porGuardar: Array<{ fila: number; accion: "crear" | "actualizar"; id?: string; datos: Record<string, unknown> }> }> {
  const def = IMPORTACIONES[p.tipo];
  const decisiones = p.decisiones ?? DECISIONES_POR_OMISION;
  const { encabezados, filas } = leerCsv(p.contenido);

  if (!filas.length) throw new ErrorDeImportacion("El archivo no tiene renglones de datos.");
  if (filas.length > LIMITE_FILAS) {
    throw new ErrorDeImportacion(`El archivo trae ${filas.length} renglones; el máximo por carga es ${LIMITE_FILAS}. Divídalo en partes.`);
  }
  const faltantes = def.columnas.filter((c) => c.requerido && !encabezados.includes(c.nombre)).map((c) => c.nombre);
  if (faltantes.length) {
    throw new ErrorDeImportacion(
      `Faltan columnas obligatorias: ${faltantes.join(", ")}. Descargue la plantilla: trae los encabezados exactos.`,
    );
  }
  const conocidas = new Set(def.columnas.map((c) => c.nombre));
  const columnasDesconocidas = encabezados.filter((e) => e && !conocidas.has(e));

  const [mapas, existentes, zona] = await Promise.all([
    def.contexto(p.organizationId),
    def.existentes(p.organizationId),
    zonaDe(p.organizationId),
  ]);
  const porClave = new Map<string, Existente>();
  for (const e of existentes) if (!porClave.has(e.clave)) porClave.set(e.clave, e);

  const salida: FilaAnalizada[] = [];
  const porGuardar: Array<{ fila: number; accion: "crear" | "actualizar"; id?: string; datos: Record<string, unknown> }> = [];
  const clavesDelArchivo = new Map<string, number>();
  const nuevasDelArchivo: Array<{ fila: number; resumen: string; comparar: Comparable }> = [];

  filas.forEach((fila, i) => {
    const numero = i + 2; // +1 por el encabezado, +1 porque Excel cuenta desde 1
    const r = def.convertir(fila, { zona, mapas });

    if (!r.ok) {
      salida.push({ fila: numero, estado: "error", resumen: r.resumen, fallas: r.fallas, advertencias: [] });
      return;
    }

    const repetida = clavesDelArchivo.get(r.clave);
    if (repetida) {
      salida.push({
        fila: numero, estado: "error", resumen: r.resumen, clave: r.clave, advertencias: r.advertencias,
        fallas: [{ motivo: `Repetido dentro del archivo: la fila ${repetida} ya trae esta misma clave` }],
      });
      return;
    }
    clavesDelArchivo.set(r.clave, numero);

    const existente = porClave.get(r.clave);
    if (existente) {
      const actualizar = decisiones.exactos === "actualizar" && Boolean(def.actualizar);
      salida.push({
        fila: numero, estado: actualizar ? "actualizar" : "exacto", resumen: r.resumen, clave: r.clave,
        fallas: [], advertencias: r.advertencias,
        coincide: { id: existente.id, resumen: existente.resumen, motivo: "misma clave" },
      });
      if (actualizar) porGuardar.push({ fila: numero, accion: "actualizar", id: existente.id, datos: r.datos });
      return;
    }

    // Posible duplicado: contra lo que ya existe y contra lo nuevo del archivo.
    let coincide: FilaAnalizada["coincide"];
    for (const e of existentes) {
      const motivo = parecido(r.comparar, e.comparar);
      if (motivo) { coincide = { id: e.id, resumen: e.resumen, motivo }; break; }
    }
    if (!coincide) {
      for (const n of nuevasDelArchivo) {
        const motivo = parecido(r.comparar, n.comparar);
        if (motivo) { coincide = { id: null, resumen: `${n.resumen} (fila ${n.fila} del archivo)`, motivo }; break; }
      }
    }
    if (coincide && !decisiones.crearPosibles.includes(numero)) {
      salida.push({ fila: numero, estado: "posible", resumen: r.resumen, clave: r.clave, fallas: [], advertencias: r.advertencias, coincide });
      return;
    }

    salida.push({
      fila: numero, estado: "nuevo", resumen: r.resumen, clave: r.clave, fallas: [], advertencias: r.advertencias,
      ...(coincide ? { coincide } : {}),
    });
    nuevasDelArchivo.push({ fila: numero, resumen: r.resumen, comparar: r.comparar });
    porGuardar.push({ fila: numero, accion: "crear", datos: r.datos });
  });

  const cuenta = (e: EstadoFila) => salida.filter((f) => f.estado === e).length;
  const totales = {
    leidos: filas.length,
    nuevos: cuenta("nuevo"),
    actualizar: cuenta("actualizar"),
    exactos: cuenta("exacto"),
    posibles: cuenta("posible"),
    errores: cuenta("error"),
    advertencias: salida.filter((f) => f.advertencias.length).length,
  };

  return {
    filas: salida,
    totales,
    columnasDesconocidas,
    puedeImportar: totales.errores === 0 && totales.nuevos + totales.actualizar > 0,
    _porGuardar: porGuardar,
  };
}

/** La vista previa, sin los datos internos, y registrada en la bitácora. */
export async function validarImportacion(p: {
  tipo: ClaveImportacion;
  contenido: string;
  organizationId: string;
  userId: string;
  archivoNombre?: string | null;
  decisiones?: Decisiones;
}): Promise<Analisis> {
  const { _porGuardar, ...analisis } = await analizarImportacion(p);
  void _porGuardar;
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Importacion", entityId: p.tipo, action: "IMPORT_VALIDATED",
    summary: `${IMPORTACIONES[p.tipo].titulo}: ${analisis.totales.leidos} renglones — ${analisis.totales.nuevos} nuevos, ${analisis.totales.errores} con error, ${analisis.totales.exactos + analisis.totales.posibles} duplicados`,
    // Sin contenido del archivo: solo su nombre y conteos.
    changes: { archivo: p.archivoNombre ?? null, totales: analisis.totales },
  });
  return analisis;
}

export type ResultadoImportacion = {
  loteId: string;
  creados: number;
  actualizados: number;
  omitidos: number;
};

/**
 * Guarda la importación: vuelve a validar, y si todo está en regla, escribe en
 * UNA transacción y deja el lote.
 *
 * `fallarEnFila` existe solo para las pruebas: provoca una falla real a media
 * transacción, para comprobar que no queda ni un registro. No lo usa ninguna
 * pantalla.
 */
export async function ejecutarImportacion(p: {
  tipo: ClaveImportacion;
  contenido: string;
  organizationId: string;
  userId: string;
  plan: string;
  archivoNombre?: string | null;
  decisiones?: Decisiones;
  fallarEnFila?: number;
}): Promise<ResultadoImportacion> {
  const def = IMPORTACIONES[p.tipo];
  const huella = createHash("sha256").update(p.contenido).digest("hex");

  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "Importacion", entityId: p.tipo, action: "IMPORT_STARTED",
    summary: `${def.titulo}: se confirmó la importación de ${p.archivoNombre ?? "un archivo"}`,
    changes: { archivo: p.archivoNombre ?? null, huella },
  });

  const analisis = await analizarImportacion(p);
  const { totales } = analisis;

  const registrarFalla = async (motivo: string) => {
    const lote = await prisma.importBatch.create({
      data: {
        organizationId: p.organizationId, userId: p.userId, tipo: p.tipo,
        archivoNombre: p.archivoNombre ?? null, archivoHuella: huella,
        estado: "FALLIDO", leidos: totales.leidos, rechazados: totales.errores,
        detalle: JSON.stringify({ motivo }),
      },
    });
    await logAudit({
      organizationId: p.organizationId, userId: p.userId,
      entity: "ImportBatch", entityId: lote.id, action: "IMPORT_FAILED",
      summary: `${def.titulo}: la importación no se hizo — ${motivo}`,
    });
    return lote;
  };

  if (totales.errores > 0) {
    await registrarFalla(`${totales.errores} renglón(es) con error`);
    throw new ErrorDeImportacion(
      `Hay ${totales.errores} renglón(es) con error. Corrija el archivo y vuelva a validarlo: no se importó nada.`,
    );
  }
  const creables = analisis._porGuardar.filter((g) => g.accion === "crear").length;
  if (analisis._porGuardar.length === 0) {
    throw new ErrorDeImportacion("No hay nada que importar: todos los renglones ya existen o se decidió omitirlos.");
  }

  if (def.recurso && creables > 0) {
    const cupo = await verificarCupo(p.organizationId, p.plan, def.recurso, creables);
    if (!cupo.permitido) {
      await registrarFalla(cupo.mensaje);
      throw new ErrorDeImportacion(cupo.mensaje, 402);
    }
  }

  let resultado: ResultadoImportacion;
  try {
    resultado = await prisma.$transaction(async (tx) => {
      const lote = await tx.importBatch.create({
        data: {
          organizationId: p.organizationId, userId: p.userId, tipo: p.tipo,
          archivoNombre: p.archivoNombre ?? null, archivoHuella: huella, estado: "IMPORTADO",
          leidos: totales.leidos,
          omitidos: totales.exactos + totales.posibles,
          rechazados: 0,
        },
      });

      let creados = 0;
      let actualizados = 0;
      for (const g of analisis._porGuardar) {
        if (p.fallarEnFila === g.fila) throw new Error(`Falla provocada en la fila ${g.fila}`);
        if (g.accion === "crear") {
          const nuevo = await def.insertar(tx, p.organizationId, g.datos);
          await tx.importRecord.create({
            data: { batchId: lote.id, entity: def.entidad, entityId: nuevo.id, accion: "CREATED" },
          });
          creados++;
        } else if (g.id && def.actualizar) {
          const antes = await def.actualizar(tx, p.organizationId, g.id, g.datos);
          await tx.importRecord.create({
            data: { batchId: lote.id, entity: def.entidad, entityId: g.id, accion: "UPDATED", antes: JSON.stringify(antes) },
          });
          actualizados++;
        }
      }

      await tx.importBatch.update({ where: { id: lote.id }, data: { creados, actualizados } });
      return { loteId: lote.id, creados, actualizados, omitidos: totales.exactos + totales.posibles };
    }, { timeout: 5 * 60_000, maxWait: 20_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const motivo = /Unique constraint/i.test(m)
      ? "otro registro con la misma clave se creó mientras se importaba"
      : m.slice(0, 200);
    await registrarFalla(motivo);
    throw new ErrorDeImportacion(
      `La importación no se completó (${motivo}). No se guardó ningún renglón: la base quedó como estaba.`,
      500,
    );
  }

  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: resultado.loteId, action: "IMPORTED",
    summary: `${def.titulo}: ${resultado.creados} creados, ${resultado.actualizados} actualizados, ${resultado.omitidos} omitidos`,
    changes: { archivo: p.archivoNombre ?? null, huella },
  });
  return resultado;
}
