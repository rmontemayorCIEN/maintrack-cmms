import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Badge, Card, CardHeader, PageHeader, Progress, Stat } from "@/components/ui";
import { nivelSalud, saludDeDatos } from "@/lib/salud-datos";
import { ultimoDiagnostico } from "@/lib/ia/diagnostico";
import { consumoIa } from "@/lib/ia/consumo";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { formatDateTime } from "@/lib/utils";
import { BotonDiagnostico } from "./boton";

export const metadata = { title: "Diagnostico" };
export const dynamic = "force-dynamic";

const COLOR_SEMAFORO = {
  BIEN: "success",
  ATENCION: "warning",
  RIESGO: "danger",
} as const;

const COLOR_SEVERIDAD = {
  ALTA: "danger",
  MEDIA: "warning",
  BAJA: "muted",
} as const;

const ETIQUETA_CATEGORIA: Record<string, string> = {
  RIESGO: "Riesgo",
  CAPTURA: "Captura",
  COSTO: "Costo",
  CUMPLIMIENTO: "Cumplimiento",
  OPORTUNIDAD: "Oportunidad",
};

export default async function DiagnosticoPage() {
  const user = await requireUser();
  const [salud, reporte, consumo] = await Promise.all([
    saludDeDatos(user.organizationId),
    ultimoDiagnostico(user.organizationId),
    consumoIa(user.organizationId),
  ]);

  const entitlement = iaDeLaOrganizacion(user.organization);
  const nivel = nivelSalud(salud.indice);
  const puedeGenerar = can(user.role, "settings:write");
  const restantes = Math.max(0, entitlement.operaciones - consumo.operaciones);

  return (
    <>
      <PageHeader
        title="Diagnóstico de la operación"
        description="Cada semana el sistema revisa sus indicadores, su backlog, sus costos y la calidad de su captura, y entrega los hallazgos con la evidencia que los sostiene."
        actions={
          puedeGenerar ? (
            <BotonDiagnostico
              disponible={entitlement.funciones.includes("DIAGNOSTICO") && iaConfigurada()}
              restantes={restantes}
            />
          ) : null
        }
      />

      {entitlement.funciones.includes("DIAGNOSTICO") && !iaConfigurada() ? (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          La generacion con inteligencia artificial aun no esta habilitada en este servidor. El indice de
          captura de abajo funciona igual; el diagnostico aparecera en cuanto su proveedor la active.
        </div>
      ) : null}

      {/* ─────────────────────────── Calidad de la captura ───────────────── */}
      <div className="mb-5 grid gap-4 lg:grid-cols-[280px_1fr]">
        <Stat
          label="Calidad de la captura"
          value={`${salud.indice}/100`}
          hint={`Captura ${nivel.etiqueta.toLowerCase()}`}
          tone={salud.indice >= 85 ? "good" : salud.indice >= 65 ? "default" : salud.indice >= 40 ? "warn" : "bad"}
        />

        <Card>
          <CardHeader
            title="Que le falta capturar"
            subtitle="Un indicador solo vale lo que vale el dato que lo alimenta. Esto no usa inteligencia artificial: son cuentas sobre su propia informacion."
          />
          {salud.huecos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-4 text-center text-xs text-emerald-700">
              No hay huecos de captura. Sus indicadores se sostienen.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {salud.huecos.slice(0, 5).map((h) => (
                <li key={h.clave}>
                  <Link href={h.enlace} className="group block rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs font-medium text-slate-700 group-hover:text-brand-700">
                        {h.titulo}
                      </p>
                      <p className="shrink-0 text-[0.6875rem] tabular-nums text-slate-500">
                        {h.cumplidos}/{h.total} · faltan {h.total - h.cumplidos}
                      </p>
                    </div>
                    <div className="mt-1"><Progress value={h.porcentaje} tone={h.porcentaje >= 80 ? "good" : h.porcentaje >= 50 ? "warn" : "bad"} /></div>
                    <p className="mt-1 text-[0.6875rem] text-slate-500">{h.porque}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ──────────────────────────────── El diagnostico ─────────────────── */}
      {!entitlement.funciones.includes("DIAGNOSTICO") ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Sparkles className="h-7 w-7 text-brand-400" />
            <div>
              <p className="text-sm font-semibold text-slate-800">El diagnostico con IA no viene en su plan</p>
              <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
                Se incluye desde el plan Professional, y se puede activar sobre cualquier plan de pago con el
                complemento IA Avanzada. El indice de captura de arriba lo tiene siempre, sin costo.
              </p>
            </div>
            <Link
              href="/settings?tab=suscripcion"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700"
            >
              Ver planes y complementos <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      ) : !reporte?.contenido ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="h-7 w-7 text-slate-300" />
            <p className="text-sm font-semibold text-slate-800">Aun no hay diagnostico</p>
            <p className="mx-auto max-w-lg text-xs text-slate-500">
              El primero se genera automaticamente el proximo lunes. Si no quiere esperar, puede generarlo ahora
              con el boton de arriba.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone={COLOR_SEMAFORO[reporte.contenido.semaforo]}>
                    {reporte.contenido.semaforo === "BIEN" ? "Sin pendientes críticos"
                      : reporte.contenido.semaforo === "ATENCION" ? "Requiere atención" : "En riesgo"}
                  </Badge>
                  <span className="text-[0.6875rem] text-slate-400">
                    {formatDateTime(reporte.creadoEl)} · periodo {reporte.desde.toISOString().slice(0, 10)} al {reporte.hasta.toISOString().slice(0, 10)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-800">{reporte.contenido.resumen}</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Hallazgos"
              subtitle="Cada uno con la cifra que lo sostiene y la acción que le corresponde."
            />
            <ul className="grid gap-3">
              {reporte.contenido.hallazgos.map((h, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={COLOR_SEVERIDAD[h.severidad]}>{h.severidad}</Badge>
                    <Badge tone="muted">{ETIQUETA_CATEGORIA[h.categoria] ?? h.categoria}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{h.titulo}</p>
                  <p className="mt-1.5 text-xs text-slate-600">
                    <span className="font-medium text-slate-500">Evidencia · </span>{h.evidencia}
                  </p>
                  <p className="mt-1 text-xs text-slate-700">
                    <span className="font-medium text-slate-500">Accion · </span>{h.accion}
                  </p>
                  {h.enlace ? (
                    <Link
                      href={h.enlace}
                      className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-brand-600 hover:underline"
                    >
                      Ir a atenderlo <ArrowRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Matriz FODA" subtitle="El resumen para dirección." />
            <div className="grid gap-3 md:grid-cols-2">
              <Cuadrante titulo="Fortalezas" tono="border-emerald-200 bg-emerald-50/40" puntos={reporte.contenido.foda.fortalezas} />
              <Cuadrante titulo="Oportunidades" tono="border-blue-200 bg-blue-50/40" puntos={reporte.contenido.foda.oportunidades} />
              <Cuadrante titulo="Debilidades" tono="border-amber-200 bg-amber-50/40" puntos={reporte.contenido.foda.debilidades} />
              <Cuadrante titulo="Amenazas" tono="border-red-200 bg-red-50/40" puntos={reporte.contenido.foda.amenazas} />
            </div>
          </Card>

          <p className="flex items-start gap-1.5 text-[0.6875rem] text-slate-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            Los numeros los calcula el sistema sobre su base de datos; la inteligencia artificial solo los
            interpreta. Aun asi, verifique en la pantalla correspondiente antes de tomar una decision de gasto.
          </p>
        </div>
      )}
    </>
  );
}

function Cuadrante({ titulo, tono, puntos }: { titulo: string; tono: string; puntos: string[] }) {
  return (
    <div className={`rounded-lg border p-3 ${tono}`}>
      <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-600">{titulo}</p>
      {puntos.length === 0 ? (
        <p className="text-xs text-slate-400">—</p>
      ) : (
        <ul className="grid gap-1">
          {puntos.map((p, i) => (
            <li key={i} className="text-xs leading-relaxed text-slate-700">• {p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
