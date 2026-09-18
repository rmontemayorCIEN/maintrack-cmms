/**
 * El recorrido de una importación: leer, validar, decidir, guardar todo o nada.
 *
 * Lo llaman la ruta y las pruebas —la MISMA función—, así que lo que se prueba
 * es lo que corre en producción.
 *
 * Las reglas, en el orden en que importan:
 *
 *  1. **Un Excel y un CSV son lo mismo.** Se leen a la misma tabla de texto y de
 *     ahí en adelante no hay dos caminos: mismas validaciones, misma vista
 *     previa, mismos duplicados, mismo lote.
 *  2. **Validar no escribe datos.** La vista previa lee la base para saber qué
 *     existe. Lo único que deja es la entrada del historial —«validada»— para
 *     que se sepa qué archivo se revisó; ningún sitio, activo ni movimiento.
 *  3. **Con un renglón rechazado no se importa nada.** Esa es la política, y se
 *     dice antes de confirmar. Importar «lo que sí se pudo» deja la mitad
 *     arriba y la otra en el aire: una planta con la mitad de sus equipos se ve
 *     completa y no lo está.
 *  4. **Todo o nada.** La escritura va en UNA transacción: si a la mitad falla
 *     algo no queda ni un registro, ni relaciones rotas. Ninguna importación
 *     consume folios consecutivos, así que una falla tampoco deja huecos.
 *  5. **Los duplicados se deciden, no se adivinan.** Exacto: se omite o se
 *     actualiza. Probable: se omite salvo que alguien diga «créalo». Nunca se
 *     combinan dos registros por parecido.
 *  6. **Cada importación es un lote**, con su historia: validada, confirmada,
 *     completada —con o sin advertencias— o fallida; después, revertida o no.
 */
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { leerCsv, type FilaCsv } from "./csv";
import { ErrorDeXlsx, leerXlsx } from "./xlsx";
import { logAudit } from "./audit";
import { verificarCupo } from "./planes";
import { ZONA_POR_OMISION } from "./periodos";
import type { EstadoLote } from "./estados-lote";
import {
  IMPORTACIONES, type ClaveImportacion, type Comparable, type Existente, type Falla,
} from "./importacion";

export const LIMITE_FILAS = 5000;
/** 8 MB de archivo; en Excel llega en base64, que ocupa un tercio más. */
export const LIMITE_BYTES = 8 * 1024 * 1024;

/**
 * La política ante renglones rechazados, dicha igual en la pantalla, en la
 * respuesta y en el documento del bloque.
 */
export const POLITICA_RECHAZOS =
  "Si algún renglón tiene error, no se importa nada: corrija el archivo y vuelva a validarlo. Los posibles duplicados se omiten salvo que usted marque crearlos.";

export { ESTADOS_CON_REGISTROS, type EstadoLote } from "./estados-lote";

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

export type Archivo = {
  nombre?: string | null;
  /** «csv» trae el texto; «xlsx», el archivo en base64. */
  formato: "csv" | "xlsx";
  contenido: string;
};

export type Analisis = {
  loteId?: string;
  formato: "csv" | "xlsx";
  filas: FilaAnalizada[];
  totales: {
    leidos: number; validos: number; conAdvertencias: number; rechazados: number;
    nuevos: number; actualizar: number; exactos: number; posibles: number;
    /** Alias de `rechazados`, por compatibilidad con la primera versión. */
    errores: number; advertencias: number;
  };
  columnasDesconocidas: string[];
  columnasFaltantes: string[];
  /** Avisos del archivo completo: columnas ignoradas a propósito, por ejemplo. */
  avisosArchivo: string[];
  puedeImportar: boolean;
  politica: string;
  actualizable: boolean;
  despues?: string;
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
  if (a.firma && b.firma && a.firma === b.firma) return "mismo equipo, tipo y frecuencia";
  if (a.nombre && b.nombre && a.nombre === b.nombre && (a.ambito ?? "") === (b.ambito ?? "")) {
    return a.ambito ? "mismo nombre en el mismo lugar" : "mismo nombre";
  }
  return null;
}

async function zonaDe(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || ZONA_POR_OMISION;
}

/**
 * El archivo como tabla, venga de Excel o de CSV. La huella se saca de los
 * bytes originales: identifica el archivo sin guardar su contenido.
 */
export function leerArchivo(a: Archivo): { encabezados: string[]; filas: FilaCsv[]; huella: string } {
  if (a.formato === "xlsx") {
    const bytes = Buffer.from(a.contenido, "base64");
    if (bytes.length > LIMITE_BYTES) throw new ErrorDeImportacion("El archivo pasa de 8 MB. Divídalo en partes.");
    try {
      return { ...leerXlsx(bytes), huella: createHash("sha256").update(bytes).digest("hex") };
    } catch (e) {
      if (e instanceof ErrorDeXlsx) throw new ErrorDeImportacion(e.message);
      throw new ErrorDeImportacion("No se pudo leer el archivo de Excel. Ábralo y guárdelo de nuevo como «Libro de Excel (.xlsx)», o expórtelo a CSV.");
    }
  }
  if (Buffer.byteLength(a.contenido) > LIMITE_BYTES) throw new ErrorDeImportacion("El archivo pasa de 8 MB. Divídalo en partes.");
  return { ...leerCsv(a.contenido), huella: createHash("sha256").update(a.contenido).digest("hex") };
}

/** El formato por la extensión del nombre, si no se dijo. */
export function formatoDe(nombre: string | null | undefined): "csv" | "xlsx" {
  return /\.xlsx$/i.test(nombre ?? "") ? "xlsx" : "csv";
}

type Entrada = {
  tipo: ClaveImportacion;
  organizationId: string;
  decisiones?: Decisiones;
  /** El archivo. `contenido` a secas se toma como CSV, por compatibilidad. */
  archivo?: Archivo;
  contenido?: string;
  archivoNombre?: string | null;
};

const archivoDe = (p: Entrada): Archivo =>
  p.archivo ?? { formato: formatoDe(p.archivoNombre), contenido: p.contenido ?? "", nombre: p.archivoNombre };

type PorGuardar = { fila: number; accion: "crear" | "actualizar"; id?: string; datos: Record<string, unknown> };

/**
 * Lee el archivo y dice qué pasaría con cada renglón. NO escribe nada.
 *
 * La ejecución vuelve a llamar a esta función, sobre la base de ese momento, y
 * no confía en una vista previa vieja.
 */
export async function analizarImportacion(p: Entrada): Promise<Analisis & { _porGuardar: PorGuardar[]; _huella: string }> {
  const def = IMPORTACIONES[p.tipo];
  const decisiones = p.decisiones ?? DECISIONES_POR_OMISION;
  const archivo = archivoDe(p);
  const { encabezados, filas, huella } = leerArchivo(archivo);

  if (!filas.length) throw new ErrorDeImportacion("El archivo no tiene renglones de datos.");
  if (filas.length > LIMITE_FILAS) {
    throw new ErrorDeImportacion(`El archivo trae ${filas.length} renglones; el máximo por carga es ${LIMITE_FILAS}. Divídalo en partes.`);
  }

  const conocidas = new Set(def.columnas.map((c) => c.nombre));
  const prohibidas = def.columnasProhibidas ?? {};
  const columnasFaltantes = def.columnas.filter((c) => c.requerido && !encabezados.includes(c.nombre)).map((c) => c.nombre);
  const columnasDesconocidas = encabezados.filter((e) => e && !conocidas.has(e));
  const avisosArchivo = encabezados
    .filter((e) => prohibidas[e.toLowerCase()])
    .map((e) => `La columna «${e}» se ignora: ${prohibidas[e.toLowerCase()].toLowerCase()}. No se lee ni se guarda.`);

  const base = {
    formato: archivo.formato,
    columnasDesconocidas, columnasFaltantes, avisosArchivo,
    politica: POLITICA_RECHAZOS,
    actualizable: Boolean(def.actualizar),
    despues: def.despues,
    _huella: huella,
  };

  // Sin las columnas obligatorias no tiene sentido revisar renglón por renglón:
  // todos fallarían por lo mismo. Se dice cuáles faltan y se detiene ahí.
  if (columnasFaltantes.length) {
    return {
      ...base,
      filas: [],
      totales: { leidos: filas.length, validos: 0, conAdvertencias: 0, rechazados: filas.length, nuevos: 0, actualizar: 0, exactos: 0, posibles: 0, errores: filas.length, advertencias: 0 },
      puedeImportar: false,
      _porGuardar: [],
    };
  }

  const [mapas, existentes, zona] = await Promise.all([
    def.contexto(p.organizationId),
    def.existentes(p.organizationId),
    zonaDe(p.organizationId),
  ]);
  const porClave = new Map<string, Existente>();
  for (const e of existentes) if (!porClave.has(e.clave)) porClave.set(e.clave, e);

  // Primero se convierte todo; lo que necesita la base (un correo en otra
  // empresa, una lectura contra la anterior) se revisa de un golpe después.
  const convertidas = filas.map((fila, i) => ({ numero: i + 2, r: def.convertir(fila, { zona, mapas }) }));
  const globales = def.revisionGlobal
    ? await def.revisionGlobal(
        p.organizationId,
        convertidas.filter((c) => c.r.ok).map((c) => ({ fila: c.numero, datos: (c.r as { datos: Record<string, unknown> }).datos })),
      )
    : new Map<number, Falla>();

  const salida: FilaAnalizada[] = [];
  const porGuardar: PorGuardar[] = [];
  const clavesDelArchivo = new Map<string, number>();
  const nuevasDelArchivo: Array<{ fila: number; resumen: string; comparar: Comparable }> = [];

  for (const { numero, r } of convertidas) {
    if (!r.ok) {
      salida.push({ fila: numero, estado: "error", resumen: r.resumen, fallas: r.fallas, advertencias: [] });
      continue;
    }
    const global = globales.get(numero);
    if (global) {
      salida.push({ fila: numero, estado: "error", resumen: r.resumen, clave: r.clave, fallas: [global], advertencias: r.advertencias });
      continue;
    }

    const repetida = clavesDelArchivo.get(r.clave);
    if (repetida) {
      salida.push({
        fila: numero, estado: "error", resumen: r.resumen, clave: r.clave, advertencias: r.advertencias,
        fallas: [{
          motivo: `Repetido dentro del archivo: la fila ${repetida} ya trae la misma clave`,
          solucion: "Deje uno solo de los dos renglones, o corrija el código del que está mal",
        }],
      });
      continue;
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
      continue;
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
      continue;
    }

    salida.push({
      fila: numero, estado: "nuevo", resumen: r.resumen, clave: r.clave, fallas: [], advertencias: r.advertencias,
      ...(coincide ? { coincide } : {}),
    });
    nuevasDelArchivo.push({ fila: numero, resumen: r.resumen, comparar: r.comparar });
    porGuardar.push({ fila: numero, accion: "crear", datos: r.datos });
  }

  const cuenta = (e: EstadoFila) => salida.filter((f) => f.estado === e).length;
  const rechazados = cuenta("error");
  const conAdvertencias = salida.filter((f) => f.estado !== "error" && f.advertencias.length).length;
  const totales = {
    leidos: filas.length,
    validos: filas.length - rechazados,
    conAdvertencias,
    rechazados,
    nuevos: cuenta("nuevo"),
    actualizar: cuenta("actualizar"),
    exactos: cuenta("exacto"),
    posibles: cuenta("posible"),
    errores: rechazados,
    advertencias: conAdvertencias,
  };

  return {
    ...base,
    filas: salida,
    totales,
    puedeImportar: rechazados === 0 && totales.nuevos + totales.actualizar > 0,
    _porGuardar: porGuardar,
  };
}

/** Los errores que se guardan en el lote: los primeros, sin el archivo completo. */
function erroresParaLote(filas: FilaAnalizada[], faltantes: string[]) {
  return {
    columnasFaltantes: faltantes,
    errores: filas.filter((f) => f.estado === "error").slice(0, 50)
      .flatMap((f) => f.fallas.map((x) => ({ fila: f.fila, columna: x.columna ?? null, motivo: x.motivo }))),
  };
}

/**
 * La vista previa. No escribe datos: deja la entrada «validada» en el historial
 * —la misma si se vuelve a validar el mismo archivo— y la nota en la bitácora.
 */
export async function validarImportacion(p: Entrada & { userId: string }): Promise<Analisis> {
  const { _porGuardar, _huella, ...analisis } = await analizarImportacion(p);
  void _porGuardar;
  const nombre = p.archivo?.nombre ?? p.archivoNombre ?? null;
  const t = analisis.totales;
  const datosLote = {
    leidos: t.leidos, omitidos: t.exactos + t.posibles, rechazados: t.rechazados,
    detalle: JSON.stringify(erroresParaLote(analisis.filas, analisis.columnasFaltantes)),
  };

  // Validar otra vez el mismo archivo —por ejemplo, al cambiar una decisión
  // sobre duplicados— actualiza la misma entrada en vez de apilar otra.
  const previo = await prisma.importBatch.findFirst({
    where: { organizationId: p.organizationId, userId: p.userId, tipo: p.tipo, archivoHuella: _huella, estado: "VALIDADA" },
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  const lote = previo
    ? await prisma.importBatch.update({ where: { id: previo.id }, data: datosLote, select: { id: true } })
    : await prisma.importBatch.create({
        data: {
          organizationId: p.organizationId, userId: p.userId, tipo: p.tipo, estado: "VALIDADA",
          archivoNombre: nombre, archivoHuella: _huella, ...datosLote,
        },
        select: { id: true },
      });

  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: lote.id, action: "IMPORT_VALIDATED",
    summary: `${IMPORTACIONES[p.tipo].titulo}: ${nombre ?? "archivo"} validado — ${t.leidos} renglones, ${t.nuevos} nuevos, ${t.rechazados} rechazados, ${t.exactos + t.posibles} duplicados`,
    // Sin contenido del archivo: solo su nombre y conteos.
    changes: { archivo: nombre, formato: analisis.formato, totales: t },
  });
  return { ...analisis, loteId: lote.id };
}

export type ResultadoImportacion = {
  loteId: string;
  estado: EstadoLote;
  creados: number;
  actualizados: number;
  omitidos: number;
  despues?: string;
};

/**
 * Guarda la importación: vuelve a validar y, si todo está en regla, escribe en
 * UNA transacción. El lote pasa por confirmada → completada o fallida.
 *
 * `fallarEnFila` existe solo para las pruebas: provoca una falla real a media
 * transacción, para comprobar que no queda ni un registro. No lo usa ninguna
 * pantalla.
 */
export async function ejecutarImportacion(p: Entrada & {
  userId: string;
  plan: string;
  fallarEnFila?: number;
}): Promise<ResultadoImportacion> {
  const def = IMPORTACIONES[p.tipo];
  const nombre = p.archivo?.nombre ?? p.archivoNombre ?? null;
  const analisis = await analizarImportacion(p);
  const { totales } = analisis;
  const huella = analisis._huella;

  // La entrada del historial: la que dejó la validación de este mismo archivo,
  // o una nueva si se confirma sin haber validado (por la API).
  const previo = await prisma.importBatch.findFirst({
    where: { organizationId: p.organizationId, userId: p.userId, tipo: p.tipo, archivoHuella: huella, estado: "VALIDADA" },
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  const lote = previo
    ? await prisma.importBatch.update({
        where: { id: previo.id },
        data: { estado: "CONFIRMADA", leidos: totales.leidos, ...(nombre ? { archivoNombre: nombre } : {}) },
        select: { id: true },
      })
    : await prisma.importBatch.create({
        data: {
          organizationId: p.organizationId, userId: p.userId, tipo: p.tipo, estado: "CONFIRMADA",
          archivoNombre: nombre, archivoHuella: huella, leidos: totales.leidos,
        },
        select: { id: true },
      });
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: lote.id, action: "IMPORT_CONFIRMED",
    summary: `${def.titulo}: se confirmó la importación de ${nombre ?? "un archivo"}`,
    changes: { archivo: nombre, huella },
  });

  const fallar = async (motivo: string, codigo = 422): Promise<never> => {
    await prisma.importBatch.update({
      where: { id: lote.id },
      data: {
        estado: "FALLIDA", rechazados: totales.rechazados,
        detalle: JSON.stringify({ motivo, ...erroresParaLote(analisis.filas, analisis.columnasFaltantes) }),
      },
    });
    await logAudit({
      organizationId: p.organizationId, userId: p.userId,
      entity: "ImportBatch", entityId: lote.id, action: "IMPORT_FAILED",
      summary: `${def.titulo}: la importación no se hizo — ${motivo}`,
    });
    throw new ErrorDeImportacion(motivo, codigo);
  };

  if (analisis.columnasFaltantes.length) {
    await fallar(`Faltan columnas obligatorias: ${analisis.columnasFaltantes.join(", ")}. No se importó nada.`);
  }
  if (totales.rechazados > 0) {
    await fallar(`Hay ${totales.rechazados} renglón(es) con error. Corrija el archivo y vuelva a validarlo: no se importó nada.`);
  }
  const creables = analisis._porGuardar.filter((g) => g.accion === "crear").length;
  if (analisis._porGuardar.length === 0) {
    await fallar("No hay nada que importar: todos los renglones ya existen o se decidió omitirlos.");
  }
  if (def.recurso && creables > 0) {
    const cupo = await verificarCupo(p.organizationId, p.plan, def.recurso, creables);
    if (!cupo.permitido) await fallar(cupo.mensaje, 402);
  }

  let resultado: { creados: number; actualizados: number };
  try {
    resultado = await prisma.$transaction(async (tx) => {
      let creados = 0;
      let actualizados = 0;
      for (const g of analisis._porGuardar) {
        if (p.fallarEnFila === g.fila) throw new Error(`Falla provocada en la fila ${g.fila}`);
        if (g.accion === "crear") {
          const nuevo = await def.insertar(tx, p.organizationId, g.datos, { userId: p.userId });
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
      // El lote se cierra dentro de la misma transacción: si esto no se
      // guarda, tampoco los registros.
      await tx.importBatch.update({
        where: { id: lote.id },
        data: {
          estado: totales.conAdvertencias > 0 || totales.exactos + totales.posibles > 0 ? "COMPLETADA_CON_ADVERTENCIAS" : "COMPLETADA",
          creados, actualizados, omitidos: totales.exactos + totales.posibles, rechazados: 0,
          detalle: JSON.stringify({ advertencias: totales.conAdvertencias, omitidos: totales.exactos + totales.posibles }),
        },
      });
      return { creados, actualizados };
    }, { timeout: 5 * 60_000, maxWait: 20_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const motivo = /Unique constraint/i.test(m)
      ? "otro registro con la misma clave se creó mientras se importaba"
      : m.slice(0, 200);
    return fallar(`La importación no se completó (${motivo}). No se guardó ningún renglón: la base quedó como estaba.`, 500);
  }

  const estado: EstadoLote = totales.conAdvertencias > 0 || totales.exactos + totales.posibles > 0 ? "COMPLETADA_CON_ADVERTENCIAS" : "COMPLETADA";
  await logAudit({
    organizationId: p.organizationId, userId: p.userId,
    entity: "ImportBatch", entityId: lote.id, action: "IMPORT_COMPLETED",
    summary: `${def.titulo}: ${resultado.creados} creados, ${resultado.actualizados} actualizados, ${totales.exactos + totales.posibles} duplicados omitidos`,
    changes: { archivo: nombre, huella, creados: resultado.creados, actualizados: resultado.actualizados, omitidos: totales.exactos + totales.posibles },
  });
  return {
    loteId: lote.id, estado, ...resultado, omitidos: totales.exactos + totales.posibles,
    ...(def.despues ? { despues: def.despues } : {}),
  };
}
