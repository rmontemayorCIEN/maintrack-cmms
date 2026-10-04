import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { CATEGORIAS_PENDIENTE, trabajoPendiente, type CategoriaPendiente } from "@/lib/backlog";
import { Card, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import { vistaGuardada } from "@/lib/vistas";
import { TablaBacklog, type FilaPendiente } from "./tabla-backlog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trabajo pendiente" };

/**
 * El trabajo pendiente, completo y separado por lo que le pasa.
 *
 * Antes solo mostraba actividades liberadas: una orden vencida, una en espera
 * o una sin responsable no aparecian aqui aunque fueran justo el trabajo que
 * hay que destrabar. Cada renglon cae en una sola categoria (ver
 * `trabajoPendiente`) y dice de donde viene, cuanto lleva esperando y que
 * sigue. Una actividad suelta no se mezcla con una orden completa.
 *
 * Eran SEIS tablas, una por categoria, con nueve columnas que se deslizaban
 * de lado en el telefono. Ahora es una sola lista agrupada por categoria: se
 * lee igual de entrada, pero se puede filtrar, reordenar tocando el
 * encabezado, reagrupar por equipo o por responsable y guardar la vista. En
 * el telefono son tarjetas, no una tabla que hay que arrastrar.
 */
export default async function BacklogPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const user = await requireUser();
  const zona = user.organization.timezone || "America/Mexico_City";
  const items = await trabajoPendiente(user.organizationId, { zona });

  const categorias = (Object.keys(CATEGORIAS_PENDIENTE) as CategoriaPendiente[])
    .map((c) => ({ clave: c, ...CATEGORIAS_PENDIENTE[c], items: items.filter((i) => i.categoria === c) }));
  const horas = (xs: typeof items) => xs.reduce((a, i) => a + (i.horas ?? 0), 0);

  const filas: FilaPendiente[] = items.map((i) => ({
    id: i.id,
    categoria: i.categoria,
    categoriaTitulo: CATEGORIAS_PENDIENTE[i.categoria].titulo,
    tipo: i.tipo,
    titulo: i.titulo,
    ordenId: i.orden.id,
    ordenNumero: i.orden.number,
    origen: i.origen,
    activo: i.activo,
    prioridad: i.prioridad,
    horas: i.horas,
    motivo: i.motivo,
    nota: i.nota ?? null,
    responsable: i.responsable,
    antiguedadDias: i.antiguedadDias,
    proximaAccion: i.proximaAccion,
    avisos: i.avisos,
    yaSePuede: Boolean(i.yaSePuede),
  }));

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Trabajo pendiente"
        description="Todo lo que falta por hacer: órdenes abiertas y actividades que no se pudieron realizar, separadas por lo que les impide avanzar."
      />

      {/*
        Los recuadros ya no llevan a una sección: FILTRAN la lista por esa
        categoría. Con seis tablas, saltar a una era lo único posible; con una
        lista sola, filtrar es lo que de verdad sirve, y el filtro se queda
        escrito para poder quitarlo o afinarlo.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {categorias.map((c) => {
          const activa = f === c.titulo;
          return (
            <Link
              key={c.clave}
              href={activa ? "/backlog" : `/backlog?f=${encodeURIComponent(c.titulo)}`}
              aria-current={activa ? "true" : undefined}
              title={activa ? "Quitar este filtro" : `Ver solo: ${c.titulo}`}
              className={`rounded-xl border px-3 py-2 ${
                activa ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"
              }`}
            >
              <p className="text-xl font-semibold tabular-nums text-slate-800">{c.items.length}</p>
              <p className="text-xs font-medium text-slate-600">{c.titulo}</p>
              <p className="text-[0.6875rem] tabular-nums text-slate-400">
                {formatNumber(horas(c.items), 1)} h estimadas
              </p>
            </Link>
          );
        })}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="px-3 py-10 text-center text-sm text-slate-500">No hay trabajo pendiente.</p>
        </Card>
      ) : (
        <TablaBacklog
          pendientes={filas}
          vistaInicial={vistaGuardada(user.vistasTabla, "backlog")}
          busquedaInicial={f ?? ""}
        />
      )}
    </div>
  );
}
