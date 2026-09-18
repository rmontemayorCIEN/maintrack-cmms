import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { NuevoPunto } from "./nuevo-punto";
import { VisibilidadDelPunto } from "./visibilidad";

export const metadata = { title: "Puntos de reporte" };
export const dynamic = "force-dynamic";

/**
 * La direccion publica del portal.
 *
 * Se toma de la peticion en vez de una variable de entorno: el sistema corre
 * en una direccion de Cloud Run hoy y en un dominio propio manana, y un QR
 * impreso con la direccion equivocada es papel tirado.
 */
async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function PuntosPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const editable = can(user.role, "settings:write");
  const base = await baseUrl();

  const [puntos, sitios, ubicaciones, activos] = await Promise.all([
    prisma.reportPoint.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      include: {
        site: { select: { name: true } },
        location: { select: { name: true } },
        asset: { select: { code: true, name: true } },
        _count: { select: { solicitudes: true } },
      },
    }),
    prisma.site.findMany({ where: { organizationId: orgId }, orderBy: { code: "asc" }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, siteId: true } }),
    prisma.asset.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { code: "asc" }, take: 500,
      select: { id: true, code: true, name: true },
    }),
  ]);

  // El QR se dibuja en el servidor como SVG: se imprime nitido a cualquier
  // tamaño y la pagina no depende de JavaScript para mostrarlo.
  const conQr = await Promise.all(
    puntos.map(async (p) => ({
      ...p,
      url: `${base}/reportar/${p.token}`,
      svg: await QRCode.toString(`${base}/reportar/${p.token}`, {
        type: "svg", margin: 1, errorCorrectionLevel: "M", width: 180,
      }),
    })),
  );

  return (
    <>
      <PageHeader
        title="Puntos de reporte"
        description="Códigos QR para pegar en máquinas y áreas. Quien los escanea reporta una falla sin necesidad de cuenta ni contraseña."
        breadcrumb={
          <Link href="/requests" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Solicitudes
          </Link>
        }
        actions={
          <div className="flex items-center gap-2">
            {conQr.length ? (
              <Link
                href="/requests/puntos/imprimir"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir todos
              </Link>
            ) : null}
            {editable ? <NuevoPunto sitios={sitios} ubicaciones={ubicaciones} activos={activos} /> : null}
          </div>
        }
      />

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-600">
          <strong className="text-slate-800">Cada equipo ya trae el suyo.</strong> El código de un activo
          se genera solo la primera vez que se abre su ficha, con los datos que ya tiene — no hay que
          darlo de alta aquí. Los que sí se crean en esta pantalla son los de <strong>lugares sin equipo
          registrado</strong>: un salón, un baño, un pasillo. Ahí no hay activo del cual heredar nada.
        </p>
      </div>

      {conQr.length === 0 ? (
        <EmptyState
          title="Sin puntos de reporte"
          description="Los equipos generan el suyo al abrir su ficha. Aquí se crean los de lugares sin equipo: un salón, un baño, un pasillo."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {conQr.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.nombre}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[p.asset ? `${p.asset.code} · ${p.asset.name}` : null, p.location?.name, p.site?.name]
                      .filter(Boolean).join(" — ") || "Sin lugar específico"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={p.activo ? "success" : "muted"}>{p.activo ? "Activo" : "Inactivo"}</Badge>
                  <Badge tone={p.assetId ? "info" : "muted"}>{p.assetId ? "De equipo" : "De lugar"}</Badge>
                </div>
              </div>

              <div
                className="mx-auto mt-3 w-40 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: p.svg }}
              />

              <p className="mt-2 break-all text-center text-[0.625rem] text-slate-400">{p.url}</p>
              <p className="mt-2 text-center text-xs text-slate-600">
                {p._count.solicitudes} {p._count.solicitudes === 1 ? "reporte" : "reportes"}
              </p>

              <VisibilidadDelPunto
                puntoId={p.id}
                editable={editable}
                inicial={{ mostrarEmpresa: p.mostrarEmpresa, mostrarPlanta: p.mostrarPlanta, mostrarEquipo: p.mostrarEquipo }}
              />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
