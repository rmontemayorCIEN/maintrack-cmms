import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { verCostosDeAlmacen } from "@/lib/pantallas";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { perdidasPorPersona } from "@/lib/herramientas";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Qué se está perdiendo" };

/**
 * Lo que se pierde, en dinero y por persona.
 *
 * **Este es el reporte que hace valer el módulo.** Sin él, esto es un
 * inventario más; con él, contesta la pregunta que de verdad tiene el dueño:
 * «¿a dónde se va el dinero de las herramientas?».
 *
 * Solo para quien ve costos de almacén: es un reporte que nombra personas y
 * les pone una cifra al lado. Eso no es para cualquiera.
 */
export default async function PerdidasPage({
  searchParams,
}: {
  searchParams: Promise<{ meses?: string }>;
}) {
  const user = await requireUser();
  if (!verCostosDeAlmacen(user.role)) notFound();

  const { meses } = await searchParams;
  const cuantos = Math.min(Math.max(Number(meses) || 12, 1), 60);
  const desde = new Date(Date.now() - cuantos * 30 * 86_400_000);
  const reporte = await perdidasPorPersona(user.organizationId, { desde });

  const zona = user.organization.timezone;
  const moneda = user.organization.currency;
  const dinero = (n: number) =>
    n.toLocaleString("es-MX", { style: "currency", currency: moneda, maximumFractionDigits: 0 });

  return (
    <div>
      <Link href="/inventory/herramientas" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3 w-3" aria-hidden /> Herramientas
      </Link>

      <PageHeader
        title="Qué se está perdiendo"
        description={`Herramienta dada de baja por pérdida o daño, del ${formatDate(desde, zona)} a hoy.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Costo de lo perdido" value={dinero(reporte.costoTotal)} tone={reporte.costoTotal ? "bad" : "default"} />
        <Stat label="Piezas" value={String(reporte.piezasTotal)} />
        {/* El desgaste va aparte y NO suma al total: mezclarlos acusaría a
            alguien de que una herramienta duró ocho años. */}
        <Stat
          label="Por desgaste"
          value={dinero(reporte.porDesgaste.costo)}
          hint={`${reporte.porDesgaste.piezas} piezas · no se le atribuye a nadie`}
        />
      </div>

      {reporte.personas.length === 0 ? (
        <EmptyState
          title="No se ha perdido nada en el periodo"
          description="Aquí aparece la herramienta que se dio de baja por pérdida o daño, con su costo y quién la traía. El desgaste normal y el fin de vida útil no cuentan aquí."
        />
      ) : (
        <Card>
          <div className="space-y-5">
            {reporte.personas.map((p) => (
              <div key={p.persona.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-1">
                  <span className="font-medium text-slate-800">{p.persona.name}</span>
                  <span className="text-sm font-semibold tabular-nums text-rose-600">{dinero(p.costo)}</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {p.herramientas.map((h) => (
                    <li key={h.code} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700">
                        {h.code} — {h.name}
                        <span className="text-slate-400"> · {h.piezas} {h.piezas === 1 ? "pieza" : "piezas"}</span>
                      </span>
                      <span className="tabular-nums text-slate-600">{dinero(h.costo)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/*
            Cómo se calcula, dicho donde se lee el número. Un reporte que
            nombra personas y les pone una cifra al lado tiene que poder
            defenderse renglón por renglón.
          */}
          <p className="mt-5 border-t border-slate-200 pt-3 text-[0.625rem] text-slate-400">
            El costo es el costo promedio del almacén, el mismo que usa el kardex: no es una estimación. Cuenta
            solo lo dado de baja por pérdida o daño; el fin de vida útil y lo que dejó de usarse van aparte,
            arriba. Cada renglón corresponde a una baja registrada, con su fecha y quién la autorizó, y se puede
            revisar en la bitácora.
          </p>
        </Card>
      )}
    </div>
  );
}
