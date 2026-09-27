import { redirect } from "next/navigation";
import Link from "next/link";
import { LifeBuoy, Receipt, Sparkles, UserPlus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { estadoTecnicoPlataforma } from "@/lib/avisos/estado-plataforma";
import { formatNumber } from "@/lib/utils";
import { PanelClientes } from "./panel";
import { consumoPorOrganizacion } from "@/lib/ia/consumo";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { formatoUsd } from "@/lib/ia/precios";
import { avancePuestaEnMarcha } from "@/lib/puesta-en-marcha";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Empresas cliente" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");

  const solicitudes = await prisma.planRequest.findMany({
    where: { status: "PENDING" },
    include: {
      organization: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const [prospectosNuevos, soporteAbierto] = await Promise.all([
    prisma.prospecto.count({ where: { estado: "NUEVA" } }),
    prisma.solicitudSoporte.count({ where: { estado: { in: ["RECIBIDA", "EN_REVISION"] } } }),
  ]);

  const organizaciones = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, slug: true, plan: true, status: true,
      industry: true, tipoInstalacion: true, trialEndsAt: true, createdAt: true,
      iaComplemento: true, iaExtra: true, registrosPropios: true,
      _count: { select: { users: true, assets: true, workOrders: true } },
    },
  });

  const consumoIa = await consumoPorOrganizacion();
  const tecnico = await estadoTecnicoPlataforma();
  // La consola es del operador: las horas van en SU zona, no en la de un cliente.
  const zona = user.organization.timezone;
  // Avance de puesta en marcha por cliente: una cuenta estancada en 20% a las
  // tres semanas es una cuenta que no va a renovar, y conviene saberlo antes.
  // En serie a proposito: cada avance son varias decenas de conteos y la
  // instancia de Cloud SQL admite pocas conexiones simultaneas. Con veinte
  // clientes, en paralelo, esta pantalla se caeria.
  const avances = new Map<string, Awaited<ReturnType<typeof avancePuestaEnMarcha>>>();
  for (const o of organizaciones) {
    avances.set(o.id, await avancePuestaEnMarcha(o.id));
  }
  const costoIaDelMes = [...consumoIa.values()].reduce((s, c) => s + c.costoUsd, 0);

  const activas = organizaciones.filter((o) => ["ACTIVE", "TRIAL"].includes(o.status));
  const totalActivos = organizaciones.reduce((s, o) => s + o._count.assets, 0);
  const totalUsuarios = organizaciones.reduce((s, o) => s + o._count.users, 0);

  return (
    <>
      <PageHeader
        title="Empresas cliente"
        description="Alta y administración de las empresas que usan la plataforma. Cada una tiene sus activos, usuarios y datos completamente aislados de las demás."
        actions={
          <>
          <Link
            href="/clients/ia"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> Consumo de IA
            {costoIaDelMes > 0 ? <span className="text-slate-400">{formatoUsd(costoIaDelMes)}</span> : null}
          </Link>
          <Link
            href="/clients/cobranza"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Receipt className="h-3.5 w-3.5" /> Cobranza
          </Link>
          <Link href="/clients/prospectos" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <UserPlus className="h-3.5 w-3.5" /> Prospectos{prospectosNuevos ? <span className="rounded-full bg-amber-100 px-1.5 text-amber-900">{prospectosNuevos}</span> : null}
          </Link>
          <Link href="/clients/soporte" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <LifeBuoy className="h-3.5 w-3.5" /> Soporte{soporteAbierto ? <span className="rounded-full bg-amber-100 px-1.5 text-amber-900">{soporteAbierto}</span> : null}
          </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Empresas" value={organizaciones.length} hint={`${activas.length} activas o en prueba`} />
        <Stat label="Usuarios en total" value={totalUsuarios} />
        <Stat label="Activos administrados" value={formatNumber(totalActivos, 0)} />
        <Stat
          label="Suspendidas"
          value={organizaciones.filter((o) => o.status === "SUSPENDED").length}
          tone={organizaciones.some((o) => o.status === "SUSPENDED") ? "warn" : "good"}
        />
      </div>

      {/* Procesos que corren solos. Un proceso muerto calla igual que uno sano:
          esta tabla es la única forma de notar la diferencia sin abrir los
          registros de Cloud Run. */}
      <Card className="mb-5">
        <CardHeader
          title="Procesos programados"
          subtitle="Lo que corre sin que nadie lo pida. «Callado» significa que lleva más de tres periodos sin terminar una corrida: o dejó de correr, o algo lo está deteniendo."
        />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Proceso</th><th>Cada</th><th>Última corrida</th><th>Estado</th></tr></thead>
            <tbody>
              {tecnico.procesos.map((p) => (
                <tr key={p.clave}>
                  <td className="text-xs font-medium text-slate-700">{p.nombre}</td>
                  <td className="text-xs text-slate-500">{p.cadaMinutos < 60 ? `${p.cadaMinutos} min` : p.cadaMinutos < 1440 ? `${p.cadaMinutos / 60} h` : `${p.cadaMinutos / 1440} días`}</td>
                  <td className="text-xs text-slate-500">
                    {p.ultimoFin ? formatDateTime(p.ultimoFin, zona) : "nunca"}
                    {p.desdeMinutos !== null ? <span className="text-slate-400"> · hace {p.desdeMinutos < 60 ? `${p.desdeMinutos} min` : `${Math.round(p.desdeMinutos / 60)} h`}</span> : null}
                  </td>
                  <td className="text-xs">
                    {p.corriendo ? <Badge tone="info">corriendo</Badge>
                      : p.callado ? <Badge tone="danger">callado</Badge>
                      : p.sinDatos ? <Badge tone="muted">aún no le toca</Badge>
                      : p.ultimoOk === false ? <Badge tone="danger">falló</Badge>
                      : <Badge tone="success">al día</Badge>}
                    {p.fallasSeguidas > 1 ? <span className="ml-1 text-red-600">{p.fallasSeguidas} fallas seguidas</span> : null}
                    {p.ultimoError ? <p className="mt-0.5 text-[0.6875rem] text-red-700">{p.ultimoError}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Estado técnico de avisos e integraciones: solo conteos, sin contenido de las empresas. */}
      {tecnico.empresas.length || tecnico.plataforma.correo === "sin proveedor" ? (
        <Card className="mb-5">
          <CardHeader
            title="Avisos e integraciones"
            subtitle={`Correo: ${tecnico.plataforma.correo} · Celular: ${tecnico.plataforma.navegador}. Solo conteos: el contenido de cada empresa no se ve aquí.`}
          />
          {tecnico.empresas.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Empresa</th><th className="text-right">Entregas fallidas 24 h</th><th className="text-right">En cola</th><th>Webhooks</th><th className="text-right">Credenciales</th><th className="text-right">Errores de API 24 h</th></tr></thead>
                <tbody>
                  {tecnico.empresas.map((e) => (
                    <tr key={e.id}>
                      <td className="text-xs font-medium text-slate-700">{e.nombre}</td>
                      <td className={`text-right text-xs tabular-nums ${e.entregasFallidas24h ? "text-red-600" : "text-slate-500"}`}>{e.entregasFallidas24h}</td>
                      <td className="text-right text-xs tabular-nums text-slate-500">{e.enCola}</td>
                      <td className="text-xs">{e.webhooksActivos} activos{e.webhooksSuspendidos ? <Badge tone="danger">{e.webhooksSuspendidos} suspendido(s)</Badge> : null}</td>
                      <td className="text-right text-xs tabular-nums text-slate-500">{e.credencialesActivas}</td>
                      <td className={`text-right text-xs tabular-nums ${e.apiErrores24h ? "text-amber-600" : "text-slate-500"}`}>{e.apiErrores24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">Ninguna empresa tiene integraciones ni entregas pendientes.</p>}
        </Card>
      ) : null}

      <PanelClientes
        solicitudes={solicitudes.map((s) => ({
          id: s.id,
          empresa: s.organization.name,
          planActual: s.planActual,
          planSolicitado: s.planSolicitado,
          nota: s.nota,
          pedidoPor: s.requestedBy?.name ?? null,
          createdAt: s.createdAt.toISOString(),
        }))}
        organizaciones={organizaciones.map((o) => {
          const consumo = consumoIa.get(o.id);
          return {
            ...o,
            trialEndsAt: o.trialEndsAt?.toISOString() ?? null,
            createdAt: o.createdAt.toISOString(),
            avance: (() => {
              const a = avances.get(o.id);
              return a
                ? { ...a, operandoDesde: a.operandoDesde ? a.operandoDesde.toISOString() : null }
                : { porcentaje: 0, completa: false, siguiente: null, estadoOperativo: "CONFIGURACION" as const, operandoDesde: null };
            })(),
            ia: {
              operaciones: consumo?.operaciones ?? 0,
              incluidas: iaDeLaOrganizacion(o).operaciones,
              costoUsd: consumo?.costoUsd ?? 0,
            },
          };
        })}
        organizacionPropiaId={user.organizacionPropia.id}
      />
    </>
  );
}
