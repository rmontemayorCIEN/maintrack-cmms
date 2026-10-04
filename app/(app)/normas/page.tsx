import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { listarNormas, normasQueCambiaron, normasSugeridas } from "@/lib/normas";
import {
  CATALOGO_EN_BORRADOR, ETIQUETA_ESTADO_OBLIGACION, LO_QUE_NO_PROMETE,
  ORIGENES_NORMA, PESO_ESTADO, TONO_ESTADO_OBLIGACION, type EstadoObligacion,
} from "@/lib/normas-tipos";
import { REVISADO_POR } from "@/lib/normas-catalogo";
import { SIN_CONTRATO } from "@/app/api/normas/contrato";
import { Adoptar } from "./adoptar";

export const metadata = { title: "Cumplimiento normativo" };

/**
 * Las normas que sigue esta empresa, con su semáforo.
 *
 * El orden es por lo peor primero: quien abre esta pantalla quiere ver lo que
 * está vencido, no una lista alfabética.
 */
export default async function NormasPage() {
  const user = await requireUser();
  const puedeConfigurar = can(user.role, "settings:write");

  if (!user.organization.cumplimientoNormas) {
    return (
      <div>
        <PageHeader
          title="Cumplimiento normativo"
          description="Las normas que su empresa debe cumplir, con la evidencia de lo que sí hizo."
        />
        <Card>
          <EmptyState
            icon={<ScrollText className="h-8 w-8" aria-hidden />}
            title="Todavía no está activo en su cuenta"
            description={SIN_CONTRATO}
          />
          <div className="mt-6 border-t border-slate-200 pt-6 text-sm text-slate-600">
            <p className="font-medium text-slate-700">Para qué sirve</p>
            <p className="mt-1">
              Una obligación normativa periódica es, en el fondo, un plan de mantenimiento. Este módulo no
              reemplaza lo que ya hace el sistema: lleva el índice de qué plan, qué documento y qué registro
              responden a cada norma, y le dice si están al corriente. Cuando llega la inspección, saca el
              expediente del periodo con las órdenes cerradas y su evidencia.
            </p>
            <p className="mt-3 font-medium text-slate-700">Lo importante</p>
            <p className="mt-1">{LO_QUE_NO_PROMETE}</p>
          </div>
        </Card>
      </div>
    );
  }

  const [normas, cambiaron, sugeridas] = await Promise.all([
    listarNormas(user.organizationId),
    normasQueCambiaron(user.organizationId),
    normasSugeridas(user.organizationId, user.organization.tipoInstalacion),
  ]);

  const vivas = normas.filter((n) => n.activa);
  const cuenta = (e: EstadoObligacion) =>
    vivas.reduce((a, n) => a + n.obligaciones.filter((o) => o.estado === e).length, 0);

  const ordenadas = [...normas].sort(
    (a, b) => Number(b.activa) - Number(a.activa)
      || PESO_ESTADO[a.resumenEstado.peor] - PESO_ESTADO[b.resumenEstado.peor]
      || a.clave.localeCompare(b.clave, "es"),
  );

  return (
    <div>
      <PageHeader
        title="Cumplimiento normativo"
        description="Las normas que su empresa sigue, y con qué las está cumpliendo."
        actions={puedeConfigurar ? <LinkButton href="/normas/nueva">Agregar una norma propia</LinkButton> : undefined}
      />

      {/* La frontera del producto, dicha donde se ve el semáforo y no en letra chica. */}
      <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {LO_QUE_NO_PROMETE}
        {REVISADO_POR ? null : <span className="mt-1 block font-medium text-amber-700">{CATALOGO_EN_BORRADOR}</span>}
      </p>

      {cambiaron.length ? (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <p className="text-sm font-medium text-amber-900">
            {cambiaron.length === 1 ? "Una norma cambió" : `${cambiaron.length} normas cambiaron`} desde que las adoptó
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {cambiaron.map((c) => (
              <li key={c.id}>
                <Link href={`/normas/${encodeURIComponent(c.clave)}`} className="underline">{c.clave}</Link> — {c.titulo}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {vivas.length ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Vencidas" value={String(cuenta("VENCIDA"))} tone={cuenta("VENCIDA") ? "bad" : "default"} hint="Obligaciones fuera de plazo" />
          <Stat label="Por vencer" value={String(cuenta("POR_VENCER"))} tone={cuenta("POR_VENCER") ? "warn" : "default"} />
          {/* «Sin respaldo» no es incumplimiento: es que el sistema no tiene con qué opinar. */}
          <Stat label="Sin respaldo" value={String(cuenta("SIN_SABER"))} hint="Nada amarrado todavía" />
          <Stat label="Al corriente" value={String(cuenta("AL_CORRIENTE"))} tone={cuenta("AL_CORRIENTE") ? "good" : "default"} />
        </div>
      ) : null}

      {normas.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8" aria-hidden />}
          title="Todavía no sigue ninguna norma"
          description="Elija las que le aplican. Por el giro de su empresa le proponemos las de abajo; también puede dar de alta una propia —un requisito corporativo o de su cliente—."
        />
      ) : (
        <div className="grid gap-3">
          {ordenadas.map((n) => (
            <Card key={n.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/normas/${encodeURIComponent(n.clave)}`} className="font-medium text-slate-800 hover:underline">
                    {n.clave} — {n.titulo}
                  </Link>
                  {n.resumen ? <p className="mt-1 text-xs text-slate-500">{n.resumen}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {n.origen === "PROPIA" ? <Badge tone="info">{ORIGENES_NORMA.PROPIA.etiquetaCorta}</Badge> : null}
                  {n.cambioDesdeQueLaAdopto ? <Badge tone="warning">Cambió</Badge> : null}
                  {n.activa ? (
                    <Badge tone={TONO_ESTADO_OBLIGACION[n.resumenEstado.peor]}>
                      {ETIQUETA_ESTADO_OBLIGACION[n.resumenEstado.peor]}
                    </Badge>
                  ) : <Badge tone="muted">Ya no la sigue</Badge>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-slate-500">
                <span>{n.resumenEstado.consideradas} {n.resumenEstado.consideradas === 1 ? "obligación" : "obligaciones"}</span>
                {n.resumenEstado.vencidas ? <span className="text-rose-600">{n.resumenEstado.vencidas} {n.resumenEstado.vencidas === 1 ? "vencida" : "vencidas"}</span> : null}
                {n.resumenEstado.porVencer ? <span className="text-amber-600">{n.resumenEstado.porVencer} por vencer</span> : null}
                {n.resumenEstado.sinSaber ? <span>{n.resumenEstado.sinSaber} sin respaldo</span> : null}
                {n.resumenEstado.noAplican ? <span>{n.resumenEstado.noAplican} {n.resumenEstado.noAplican === 1 ? "no aplica" : "no aplican"}</span> : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {puedeConfigurar && (sugeridas.delGiro.length || sugeridas.otras.length) ? (
        <div className="mt-6">
          <Adoptar delGiro={sugeridas.delGiro} otras={sugeridas.otras} />
        </div>
      ) : null}
    </div>
  );
}
