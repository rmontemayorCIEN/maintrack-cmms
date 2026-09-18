import { NextResponse } from "next/server";
import { fail, withAuth } from "@/lib/api";
import { plantillaCsv } from "@/lib/csv";
import { escribirXlsx } from "@/lib/xlsx";
import { IMPORTACIONES, esImportacionValida } from "@/lib/importacion";

/**
 * Plantilla con las columnas y un renglón de ejemplo, en Excel (.xlsx) o en
 * CSV. Las dos traen exactamente lo mismo: se leen con las mismas reglas.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  if (!esImportacionValida(tipo)) return fail("Tipo desconocido", 404);
  const excel = new URL(request.url).searchParams.get("formato") === "xlsx";

  return withAuth(null, async () => {
    const def = IMPORTACIONES[tipo];
    const columnas = def.columnas.map((c) => c.nombre);
    const ejemplo = [def.columnas.map((c) => c.ejemplo)];
    if (excel) {
      return new NextResponse(new Uint8Array(escribirXlsx(columnas, ejemplo)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="plantilla-${tipo}.xlsx"`,
        },
      });
    }
    return new NextResponse(plantillaCsv(columnas, ejemplo), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="plantilla-${tipo}.csv"`,
      },
    });
  });
}
