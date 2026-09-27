import Link from "next/link";
import { Table2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { registrosDelReferido } from "@/lib/registros";
import type { Llave } from "@/lib/registros-tipos";

/**
 * Los registros propios donde aparece este equipo, esta persona o este
 * proveedor.
 *
 * Es lo que hace que una tabla del cliente no sea un Excel: el expediente del
 * generador muestra sus cargas de diesel sin que nadie las haya programado
 * ahi, porque la columna «Equipo» de esa tabla ES el equipo.
 *
 * Es un componente de SERVIDOR, a diferencia de `components/vigencias.tsx`: no
 * hay nada que capturar desde aqui —la captura vive en la tabla, con su
 * formulario y su permiso—, asi que traerlo con la pagina evita un viaje mas y
 * un estado de carga por una lista que casi siempre esta vacia.
 *
 * Devuelve null cuando no hay nada: una tarjeta vacia que dice «sin registros
 * propios» solo ocupa lugar en un expediente que ya es largo.
 */
export async function RegistrosReferidos({
  orgId,
  llave,
  refId,
  rol,
  esSuperAdmin,
  contratado,
  zona,
}: {
  orgId: string;
  llave: Llave;
  refId: string;
  rol?: string;
  esSuperAdmin?: boolean;
  /** Si la empresa contrato «Registros propios». Sin esto no se consulta nada. */
  contratado: boolean;
  zona: string;
}) {
  if (!contratado) return null;

  const grupos = await registrosDelReferido(orgId, llave, refId, { rol, esSuperAdmin });
  if (!grupos.length) return null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Table2 className="h-4 w-4 text-slate-400" aria-hidden />
            En sus registros propios
          </span>
        }
      />
      <div className="mt-3 space-y-3">
        {grupos.map((g) => (
          <div key={g.tabla.id}>
            <Link href={`/registros/${g.tabla.clave}`} className="text-sm font-medium text-slate-800 hover:underline">
              {g.tabla.nombre}
            </Link>
            <span className="ml-2 text-[0.6875rem] text-slate-500 tabular-nums">
              {g.renglones.length} {g.renglones.length === 1 ? "renglón" : "renglones"}
            </span>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-slate-500">
              {g.renglones.map((r) => (
                <li key={r.id} className="tabular-nums">
                  N° {r.folio}
                  <span className="text-slate-400">
                    {" · "}
                    {r.createdAt.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: zona })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* Se muestran los mas recientes de cada tabla: la lista completa esta en
          la tabla, con su filtro y su exportacion. */}
      <p className="mt-3 text-[0.625rem] text-slate-400">
        Los más recientes de cada tabla. Entre a la tabla para verlos todos, filtrarlos o exportarlos.
      </p>
    </Card>
  );
}
