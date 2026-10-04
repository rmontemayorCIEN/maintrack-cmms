import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { listarVigencias, deQueCuelga } from "@/lib/vigencias";
import {
  ETIQUETA_ESTADO, diasParaVencer, estadoDeVigencia, nombreDeTipo, type EstadoVigencia,
} from "@/lib/vigencias-tipos";
import { NuevaVigencia } from "./nueva";

export const metadata = { title: "Garantías y vigencias" };

/**
 * Todo lo que se vence, en un lugar.
 *
 * El orden no es por tipo ni por fecha de captura: es por lo que falta para
 * vencerse, y lo ya vencido primero. Una lista ordenada por tipo se ve
 * ordenada y no contesta la unica pregunta que trae aqui a alguien: que tengo
 * que renovar esta semana.
 */
const TONO: Record<EstadoVigencia, "success" | "warning" | "danger" | "muted" | "info"> = {
  VIGENTE: "success", POR_VENCER: "warning", VENCIDA: "danger",
  CANCELADA: "muted", SIN_VENCIMIENTO: "info",
};

const ENLACE: Record<string, (id: string) => string> = {
  asset: (id) => `/assets/${id}`,
  part: (id) => `/inventory/${id}`,
  service: () => "/catalogs",
  user: () => "/equipo",
};

export default async function VigenciasPage() {
  const user = await requireUser();
  const zona = user.organization.timezone;
  const puedeEscribir = can(user.role, "vigencia:write");
  const filas = await listarVigencias(user.organizationId);

  const conEstado = filas.map((v) => ({ ...v, estado: estadoDeVigencia(v) }));
  // Vencidas primero, luego por vencer, luego el resto; dentro de cada grupo,
  // lo que vence antes.
  const peso: Record<EstadoVigencia, number> = { VENCIDA: 0, POR_VENCER: 1, VIGENTE: 2, SIN_VENCIMIENTO: 3, CANCELADA: 4 };
  conEstado.sort((a, b) => peso[a.estado] - peso[b.estado] || (a.hasta?.getTime() ?? Infinity) - (b.hasta?.getTime() ?? Infinity));

  const cuenta = (e: EstadoVigencia) => conEstado.filter((v) => v.estado === e).length;

  return (
    <div>
      <PageHeader
        title="Garantías y vigencias"
        description="Los documentos que se vencen y hay que renovar a tiempo: garantías, pólizas de seguro, fianzas, contratos de servicio, calibraciones, permisos, licencias y certificados."
        actions={puedeEscribir ? <NuevaVigencia /> : undefined}
      />

      {conEstado.length ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* El color dice el estado antes que el número: quien abre esta pantalla
              busca lo rojo, no el total. */}
          <Stat label="Vencidas" value={String(cuenta("VENCIDA"))} tone={cuenta("VENCIDA") ? "bad" : "default"} hint="Sin cobertura ahora mismo" />
          <Stat label="Por vencer" value={String(cuenta("POR_VENCER"))} tone={cuenta("POR_VENCER") ? "warn" : "default"} hint="Dentro del plazo de aviso de su tipo" />
          <Stat label="Vigentes" value={String(cuenta("VIGENTE"))} />
          <Stat label="Documentos" value={String(conEstado.length)} />
        </div>
      ) : null}

      {conEstado.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" aria-hidden />}
          title="Todavía no hay documentos con vigencia"
          description="Aquí van las garantías de los equipos, las pólizas de seguro, las fianzas, los contratos de servicio, las calibraciones de instrumentos, los permisos de operación y las licencias del personal. Cada uno avisa antes de vencerse, y la garantía además salta cuando alguien abre una orden correctiva del equipo que cubre."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[0.625rem] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Documento</th>
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Cubre a</th>
                  <th className="px-2 py-2">Vence</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Se renueva con</th>
                </tr>
              </thead>
              <tbody>
                {conEstado.map((v) => {
                  const dias = diasParaVencer(v.hasta);
                  const dueno = v.asset ? { k: "asset", id: v.asset.id } : v.part ? { k: "part", id: v.part.id }
                    : v.user ? { k: "user", id: v.user.id } : v.service ? { k: "service", id: v.service.id } : null;
                  return (
                    <tr key={v.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2">
                        <span className={v.estado === "CANCELADA" ? "text-slate-400 line-through" : "font-medium text-slate-800"}>{v.titulo}</span>
                        {v.folio ? <span className="text-xs text-slate-500"> · {v.folio}</span> : null}
                        {v.cubre ? <p className="text-[0.6875rem] text-slate-500">{v.cubre}</p> : null}
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-600">{nombreDeTipo(v.tipo)}</td>
                      <td className="px-2 py-2 text-xs text-slate-600">
                        {dueno ? (
                          <Link href={ENLACE[dueno.k](dueno.id)} className="hover:underline">{deQueCuelga(v)}</Link>
                        ) : deQueCuelga(v)}
                      </td>
                      <td className="px-2 py-2 text-xs tabular-nums text-slate-600">
                        {v.hasta ? v.hasta.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: zona }) : "—"}
                        {dias !== null && v.estado !== "CANCELADA" ? (
                          <span className="block text-[0.625rem] text-slate-400">
                            {dias === 0 ? "hoy" : dias > 0 ? `en ${dias} d` : `hace ${Math.abs(dias)} d`}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2"><Badge tone={TONO[v.estado]}>{ETIQUETA_ESTADO[v.estado]}</Badge></td>
                      <td className="px-2 py-2 text-xs text-slate-600">{v.supplier?.name ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[0.625rem] text-slate-400">
            Cada tipo avisa con su propia anticipación: una póliza con 60 días porque hay que cotizar, una calibración
            con 30 porque se agenda con el laboratorio. Al registrar una que cubra más lejos, el aviso de la anterior
            se cierra solo.
          </p>
        </Card>
      )}

    </div>
  );
}
