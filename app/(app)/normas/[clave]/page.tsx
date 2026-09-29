import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Badge, Card, LinkButton, PageHeader, Stat } from "@/components/ui";
import { normaPorClave } from "@/lib/normas";
import {
  ETIQUETA_ESTADO_OBLIGACION, LO_QUE_NO_PROMETE, ORIGENES_NORMA, TONO_ESTADO_OBLIGACION,
} from "@/lib/normas-tipos";
import { nombreDeTipo } from "@/lib/vigencias-tipos";
import { Obligacion, type OpcionesPorPieza } from "./obligacion";
import { Actualizar } from "./actualizar";
import { DocumentosDeNorma } from "./documentos";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { iaConfigurada } from "@/lib/ia/cliente";

export async function generateMetadata({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params;
  return { title: decodeURIComponent(clave) };
}

/**
 * Una norma: qué exige y con qué la está cumpliendo esta empresa.
 *
 * Las opciones para amarrar se traen aquí, en el servidor, y de una sola vez:
 * son catálogos que caben —planes, documentos, registros— más las últimas
 * órdenes y rondines. Pedirlas por obligación serían veinte viajes.
 */
export default async function NormaPage({ params }: { params: Promise<{ clave: string }> }) {
  const { clave: crudo } = await params;
  const clave = decodeURIComponent(crudo);
  const user = await requireUser();
  if (!user.organization.cumplimientoNormas) notFound();

  const norma = await normaPorClave(user.organizationId, clave);
  if (!norma) notFound();

  const puedeConfigurar = can(user.role, "settings:write");
  const orgId = user.organizationId;

  const [planes, vigencias, tablas, rondines, ordenes, adjuntos, ligas] = await Promise.all([
    prisma.maintenancePlan.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    prisma.vigencia.findMany({ where: { organizationId: orgId }, select: { id: true, titulo: true, tipo: true }, orderBy: { titulo: "asc" } }),
    prisma.tablaPropia.findMany({ where: { organizationId: orgId, activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    // De los últimos: amarrar un rondín de hace dos años no le sirve a nadie.
    prisma.rondin.findMany({ where: { organizationId: orgId }, select: { id: true, numero: true, estado: true }, orderBy: { iniciadoEn: "desc" }, take: 50 }),
    prisma.workOrder.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, title: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.attachment.findMany({
      where: { organizationId: orgId, normaId: norma.id },
      select: { id: true, name: true, kind: true, size: true, mimeType: true, note: true, origenIa: true, createdAt: true, uploadedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referenceLink.findMany({
      where: { organizationId: orgId, normaId: norma.id },
      select: { id: true, title: true, url: true, note: true, origenIa: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const opciones: OpcionesPorPieza = {
    plan: planes.map((p) => ({ id: p.id, etiqueta: p.name, detalle: p.active ? null : "apagado" })),
    vigencia: vigencias.map((v) => ({ id: v.id, etiqueta: v.titulo, detalle: nombreDeTipo(v.tipo) })),
    tabla: tablas.map((t) => ({ id: t.id, etiqueta: t.nombre })),
    rondin: rondines.map((r) => ({ id: r.id, etiqueta: `Rondín ${r.numero}`, detalle: r.estado })),
    orden: ordenes.map((o) => ({ id: o.id, etiqueta: `${o.number} — ${o.title}` })),
  };

  const r = norma.resumenEstado;

  return (
    <div>
      <Link href="/normas" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3 w-3" aria-hidden /> Cumplimiento normativo
      </Link>

      <PageHeader
        title={`${norma.clave} — ${norma.titulo}`}
        description={norma.resumen ?? undefined}
        actions={
          <LinkButton href={`/normas/${encodeURIComponent(norma.clave)}/expediente`} variant="secondary">
            <FileText className="mr-1 h-4 w-4" aria-hidden /> Expediente
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={TONO_ESTADO_OBLIGACION[r.peor]}>{ETIQUETA_ESTADO_OBLIGACION[r.peor]}</Badge>
        {norma.origen === "PROPIA" ? <Badge tone="info">{ORIGENES_NORMA.PROPIA.etiquetaCorta}</Badge> : null}
        {norma.emisor ? <span className="text-xs text-slate-500">{norma.emisor}</span> : null}
        <span className="text-xs text-slate-400">
          {norma.origen === "PROPIA" ? ORIGENES_NORMA.PROPIA.promesa : ORIGENES_NORMA.CATALOGO.promesa}
        </span>
      </div>

      {norma.cambioDesdeQueLaAdopto && puedeConfigurar ? (
        <div className="mb-4">
          <Actualizar normaId={norma.id} />
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Vencidas" value={String(r.vencidas)} tone={r.vencidas ? "bad" : "default"} />
        <Stat label="Por vencer" value={String(r.porVencer)} tone={r.porVencer ? "warn" : "default"} />
        <Stat label="Sin respaldo" value={String(r.sinSaber)} hint="El sistema no tiene con qué opinar" />
        <Stat label="Al corriente" value={String(r.alCorriente)} tone={r.alCorriente ? "good" : "default"} />
      </div>

      {norma.fueraDeAlcance ? (
        <Card className="mb-4">
          <p className="text-sm font-medium text-slate-700">Lo que esta norma pide y aquí no se lleva</p>
          <p className="mt-1 text-sm text-slate-600">{norma.fueraDeAlcance}</p>
        </Card>
      ) : null}

      <DocumentosDeNorma
        normaId={norma.id}
        adjuntos={adjuntos.map((a) => ({
          id: a.id, name: a.name, kind: a.kind, size: a.size, mimeType: a.mimeType,
          createdAt: a.createdAt.toISOString(), subidoPor: a.uploadedBy?.name ?? null,
        }))}
        ligas={ligas}
        editable={puedeConfigurar}
        puedeIa={iaConfigurada() && iaDeLaOrganizacion(user.organization).funciones.includes("NORMA_DOCUMENTO")}
      />

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">Lo que exige, y con qué se cumple</h2>
        <div className="mt-1">
          {norma.obligaciones.map((o) => (
            <Obligacion
              key={o.id}
              normaId={norma.id}
              obligacion={o}
              opciones={opciones}
              editable={puedeConfigurar}
            />
          ))}
        </div>
      </Card>

      <p className="mt-4 text-[0.625rem] text-slate-400">{LO_QUE_NO_PROMETE}</p>
    </div>
  );
}
