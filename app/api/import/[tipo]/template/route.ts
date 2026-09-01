import { NextResponse } from "next/server";
import { fail, withAuth } from "@/lib/api";
import { plantillaCsv } from "@/lib/csv";
import { IMPORTACIONES, esImportacionValida } from "@/lib/importacion";

/** Plantilla CSV con las columnas y un renglon de ejemplo. */
export async function GET(_request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  if (!esImportacionValida(tipo)) return fail("Tipo desconocido", 404);

  return withAuth(null, async () => {
    const def = IMPORTACIONES[tipo];
    const csv = plantillaCsv(
      def.columnas.map((c) => c.nombre),
      [def.columnas.map((c) => c.ejemplo)],
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="plantilla-${tipo}.csv"`,
      },
    });
  });
}
