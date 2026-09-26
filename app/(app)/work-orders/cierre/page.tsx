import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { vistaGuardada } from "@/lib/vistas";
import { tableroDeCierre } from "@/lib/tablero-cierre";
import { TablaCierre } from "./tabla-cierre";

export const dynamic = "force-dynamic";
export const metadata = { title: "Qué falta para cerrar" };

/**
 * El semaforo de cierre de todas las ordenes, de un golpe.
 *
 * La ficha de la orden ya dice que le falta a ESA orden; quien valida no
 * trabaja de una en una. Con treinta completadas, saber cuales estan listas
 * obligaba a abrir las treinta.
 *
 * Es el MISMO criterio que aplica el servidor al cerrar (ver
 * `lib/tablero-cierre.ts`): si el tablero dijera «lista» y al cerrar el
 * sistema pidiera algo mas, seria un semaforo que hay que verificar.
 */
export default async function CierrePage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const user = await requireUser();
  const { filas, listas, conPendientes } = await tableroDeCierre(user.organizationId);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Qué falta para cerrar"
        description="El estado de cada orden ya trabajada, bloque por bloque. Verde es que ya tiene lo suyo; ámbar es lo que detiene el cierre."
        breadcrumb={
          <Link href="/work-orders" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3.5 w-3.5" /> Órdenes de trabajo
          </Link>
        }
      />

      {filas.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {/*
            Los dos recuadros filtran, como en Trabajo pendiente: tocar «listas
            para cerrar» deja en la lista solo esas, que es lo que un supervisor
            quiere hacer al sentarse a validar.
          */}
          <Link href={f === "Lista para cerrar" ? "/work-orders/cierre" : "/work-orders/cierre?f=Lista+para+cerrar"}>
            <Stat
              label="Listas para cerrar"
              value={String(listas)}
              tone={listas ? "good" : undefined}
              hint={listas ? "No les falta nada: se pueden cerrar" : "Ninguna lista todavía"}
            />
          </Link>
          <Stat label="Con algo pendiente" value={String(conPendientes)} tone={conPendientes ? "warn" : "good"} />
          <Stat label="En el tablero" value={String(filas.length)} hint="Completadas, en proceso y en espera" />
        </div>
      ) : null}

      {filas.length === 0 ? (
        <EmptyState
          title="No hay trabajo por cerrar"
          description="Aquí aparecen las órdenes que ya se trabajaron —completadas, en proceso o en espera—. Las que no han empezado no salen: su semáforo sería todo ámbar y no diría nada."
        />
      ) : (
        <TablaCierre
          filas={filas}
          vistaInicial={vistaGuardada(user.vistasTabla, "cierre")}
          busquedaInicial={f ?? ""}
        />
      )}
    </div>
  );
}
