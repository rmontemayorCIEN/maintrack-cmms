import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { leerCsv } from "@/lib/csv";
import { IMPORTACIONES, esImportacionValida, type ResultadoFila } from "@/lib/importacion";
import { verificarCupo } from "@/lib/planes";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ tipo: string }> };

const cuerpo = z.object({ contenido: z.string().min(1).max(8_000_000) });

const LIMITE_FILAS = 5000;

type Analisis = {
  fila: number;
  clave?: string;
  estado: "nuevo" | "duplicado" | "error";
  motivo?: string;
  resumen: string;
};

/** Valida el archivo y clasifica cada renglon, sin escribir nada. */
async function analizar(tipo: keyof typeof IMPORTACIONES, contenido: string, orgId: string) {
  const def = IMPORTACIONES[tipo];
  const { encabezados, filas } = leerCsv(contenido);

  if (!filas.length) {
    return { error: "El archivo no tiene renglones de datos" as const };
  }
  if (filas.length > LIMITE_FILAS) {
    return { error: `El archivo trae ${filas.length} renglones; el maximo es ${LIMITE_FILAS}. Dividalo en partes.` as const };
  }

  const faltantes = def.columnas
    .filter((c) => c.requerido && !encabezados.includes(c.nombre))
    .map((c) => c.nombre);
  if (faltantes.length) {
    return { error: `Faltan columnas obligatorias: ${faltantes.join(", ")}. Descargue la plantilla.` as const };
  }

  const [ctx, existentes] = await Promise.all([def.contexto(orgId), def.existentes(orgId)]);
  const vistasEnArchivo = new Set<string>();
  const analisis: Analisis[] = [];
  const aInsertar: Array<{ fila: number; datos: Record<string, unknown> }> = [];

  filas.forEach((fila, i) => {
    const numero = i + 2; // +1 por el encabezado, +1 porque Excel cuenta desde 1
    const r: ResultadoFila = def.convertir(fila, ctx, orgId);

    if (!r.ok) {
      analisis.push({ fila: numero, estado: "error", motivo: r.motivo, resumen: Object.values(fila)[0] ?? "" });
      return;
    }
    const resumen = String(r.datos.name ?? r.datos.code ?? r.datos.description ?? "");
    if (existentes.has(r.clave) || vistasEnArchivo.has(r.clave)) {
      analisis.push({
        fila: numero, clave: r.clave, estado: "duplicado", resumen,
        motivo: vistasEnArchivo.has(r.clave) ? "Repetido dentro del archivo" : "Ya existe en el sistema",
      });
      return;
    }
    vistasEnArchivo.add(r.clave);
    analisis.push({ fila: numero, clave: r.clave, estado: "nuevo", resumen });
    aInsertar.push({ fila: numero, datos: r.datos });
  });

  return {
    error: null,
    analisis,
    aInsertar,
    totales: {
      leidos: filas.length,
      nuevos: aInsertar.length,
      duplicados: analisis.filter((a) => a.estado === "duplicado").length,
      errores: analisis.filter((a) => a.estado === "error").length,
    },
  };
}

/** Vista previa: dice que pasaria, sin tocar la base. */
export async function POST(request: Request, { params }: Params) {
  const { tipo } = await params;
  if (!esImportacionValida(tipo)) return fail("Tipo de importación desconocido", 404);

  return withAuth("settings:write", async ({ orgId }) => {
    const { contenido } = cuerpo.parse(await request.json());
    const r = await analizar(tipo, contenido, orgId);
    if (r.error) return fail(r.error, 422);
    return ok({ analisis: r.analisis, totales: r.totales });
  });
}

/** Ejecucion: inserta solo los renglones nuevos y validos. */
export async function PUT(request: Request, { params }: Params) {
  const { tipo } = await params;
  if (!esImportacionValida(tipo)) return fail("Tipo de importación desconocido", 404);
  const def = IMPORTACIONES[tipo];

  return withAuth("settings:write", async ({ user, orgId }) => {
    const { contenido } = cuerpo.parse(await request.json());
    const r = await analizar(tipo, contenido, orgId);
    if (r.error) return fail(r.error, 422);

    // El cupo del plan se comprueba contra el total que se va a insertar, no
    // renglon por renglon: importar 400 activos con 380 de cupo debe avisar
    // antes de empezar, no dejar la carga a medias.
    if (def.recurso) {
      const cupo = await verificarCupo(orgId, user.organization.plan, def.recurso);
      if (!cupo.permitido) return fail(cupo.mensaje, 402);
    }

    const fallos: Array<{ fila: number; motivo: string }> = [];
    let insertados = 0;

    for (const item of r.aInsertar) {
      try {
        await def.insertar(orgId, item.datos);
        insertados += 1;
      } catch (e) {
        const m = e instanceof Error ? e.message : "Error al guardar";
        fallos.push({
          fila: item.fila,
          motivo: m.includes("Unique constraint") ? "Ya existe un registro con esa clave" : m.slice(0, 120),
        });
      }
    }

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Importacion", entityId: tipo,
      action: "IMPORTED",
      summary: `${def.titulo}: ${insertados} importados, ${r.totales.duplicados} omitidos, ${r.totales.errores + fallos.length} con error`,
    });

    return ok({
      insertados,
      omitidos: r.totales.duplicados,
      errores: r.totales.errores + fallos.length,
      fallos,
    });
  });
}
