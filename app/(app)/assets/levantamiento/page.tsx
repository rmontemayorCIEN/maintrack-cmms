import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, PageHeader } from "@/components/ui";
import { urlDeLectura } from "@/lib/almacenamiento";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { consumoIa } from "@/lib/ia/consumo";
import { AsistenteLevantamiento } from "./asistente";
import { instalacionDe } from "@/lib/instalaciones";

export const metadata = { title: "Levantamiento de inventario" };
export const dynamic = "force-dynamic";

export default async function LevantamientoPage() {
  const user = await requireUser();
  if (!can(user.role, "asset:write")) redirect("/assets");

  const entitlement = iaDeLaOrganizacion(user.organization);
  // El operador de la plataforma puede levantar el inventario en cualquier
  // cuenta: es el servicio de implementacion, y ocurre antes de que el cliente
  // tenga plan definido.
  const habilitado =
    iaConfigurada() &&
    (user.isSuperAdmin || entitlement.funciones.includes("LEVANTAMIENTO"));

  const [sitios, ubicaciones, uso, activos, anteriores] = await Promise.all([
    prisma.site.findMany({ where: { organizationId: user.organizationId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.location.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true, siteId: true }, orderBy: { name: "asc" } }),
    consumoIa(user.organizationId),
    prisma.asset.count({ where: { organizationId: user.organizationId } }),
    prisma.assetIntake.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true, estado: true, createdAt: true, tipo: true, descripcion: true,
        createdBy: { select: { name: true } },
        _count: { select: { propuestas: true } },
        adjuntos: {
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, storagePath: true, note: true, size: true },
        },
      },
    }),
  ]);

  // Las fotos viven en un almacen privado: cada vista genera su propio enlace
  // firmado, que caduca. No existe una direccion permanente de la evidencia.
  const expedientes = await Promise.all(
    anteriores.map(async (i) => ({
      ...i,
      fotos: await Promise.all(
        i.adjuntos.map(async (a) => ({
          ...a,
          url: await urlDeLectura(a.storagePath).catch(() => null),
        })),
      ),
    })),
  );

  return (
    <>
      <PageHeader
        title="Levantamiento de inventario asistido"
        description="Describa la instalación, conteste unas preguntas y obtenga el inventario de activos completo, listo para revisar. Lo que normalmente toma semanas de recorrido con libreta."
        breadcrumb={
          <Link href="/assets" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Activos
          </Link>
        }
      />

      {!habilitado ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-slate-800">El levantamiento asistido no esta activo</p>
            <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
              Se incluye en el plan Enterprise y en el complemento IA Avanzada. También se ofrece como servicio
              de implementación: su proveedor lo ejecuta con usted en una sesión.
            </p>
          </div>
        </Card>
      ) : !sitios.length ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-slate-800">Primero de de alta un sitio</p>
            <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
              Los activos tienen que nacer en algun lado. Cree la planta, edificio o sucursal en
              Catálogos → Sitios y regrese aquí.
            </p>
            <Link href="/catalogs?tipo=sites" className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline">
              Ir a Sitios
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {activos > 0 ? (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Esta cuenta ya tiene {activos} activos. El levantamiento <strong>agrega</strong>, no reemplaza:
              revise que no proponga equipos que ya están registrados antes de dar de alta.
            </p>
          ) : null}
          <AsistenteLevantamiento
            sitios={sitios}
            ubicaciones={ubicaciones}
            operacionesRestantes={Math.max(0, entitlement.operaciones - uso.operaciones)}
            instalacion={{
              nombre: instalacionDe(user.organization.tipoInstalacion).nombre,
              sustantivo: instalacionDe(user.organization.tipoInstalacion).sustantivo,
              ejemplo: instalacionDe(user.organization.tipoInstalacion).ejemplo,
            }}
          />
        </>
      )}

      {expedientes.length ? (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Levantamientos anteriores</h2>
          <p className="mb-3 max-w-2xl text-xs text-slate-500">
            El expediente de cada recorrido: que se propuso y las fotos de donde salio. Es lo que
            sostiene el inventario cuando alguien pregunta de donde salieron estos activos.
          </p>
          <div className="grid gap-3">
            {expedientes.map((e) => (
              <Card key={e.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {e.createdAt.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}
                      {e.createdBy?.name ? <span className="font-normal text-slate-500"> · {e.createdBy.name}</span> : null}
                    </p>
                    <p className="mt-0.5 line-clamp-2 max-w-2xl text-xs text-slate-500">{e.descripcion}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={e.estado === "APLICADO" ? "success" : "muted"}>{e.estado}</Badge>
                    <Badge tone="info">{e._count.propuestas} propuestos</Badge>
                    {e.fotos.length ? <Badge tone="muted">{e.fotos.length} fotos</Badge> : null}
                  </div>
                </div>

                {e.fotos.length ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {e.fotos.map((f) =>
                      f.url ? (
                        <a
                          key={f.id}
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block overflow-hidden rounded-lg border border-slate-200 hover:border-brand-400"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt={f.name} className="h-24 w-full object-cover" loading="lazy" />
                          <p className="truncate px-2 py-1 text-[0.6875rem] font-medium text-slate-700">{f.name}</p>
                          {f.note ? (
                            <p className="line-clamp-3 px-2 pb-1.5 text-[0.625rem] leading-snug text-slate-500">{f.note}</p>
                          ) : null}
                        </a>
                      ) : null,
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Sin fotos de evidencia.</p>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
