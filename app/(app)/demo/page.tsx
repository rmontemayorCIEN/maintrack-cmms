import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { puedeVerRuta } from "@/lib/pantallas";
import { HISTORIAS, ORDEN_RECOMENDADO, PREGUNTAS_DEMO, type Historia } from "@/lib/demo-guia";
import { DEMO, PERSONAS, vistaPreviaRestauracion } from "@/lib/demo-comercial";
import { formatDateTime } from "@/lib/utils";
import { PanelRestaurar, ReiniciarRecorrido } from "./panel";

export const metadata = { title: "Guía de la demostración" };

/** Resuelve cada registro de una historia a una liga real de esta empresa. */
async function ligas(orgId: string, h: Historia) {
  return Promise.all(h.registros.map(async (r) => {
    let href: string | null = null;
    if (r.tipo === "ruta") href = r.clave;
    if (r.tipo === "activo") { const x = await prisma.asset.findFirst({ where: { organizationId: orgId, code: r.clave }, select: { id: true } }); href = x ? `/assets/${x.id}` : null; }
    if (r.tipo === "solicitud") { const x = await prisma.workRequest.findFirst({ where: { organizationId: orgId, number: r.clave }, select: { id: true } }); href = x ? `/requests/${x.id}` : null; }
    if (r.tipo === "refaccion") { const x = await prisma.part.findFirst({ where: { organizationId: orgId, code: r.clave }, select: { id: true } }); href = x ? `/inventory/${x.id}` : null; }
    if (r.tipo === "orden") { const x = await prisma.workOrder.findFirst({ where: { organizationId: orgId, number: r.clave }, select: { id: true } }); href = x ? `/work-orders/${x.id}` : null; }
    return { ...r, href };
  }));
}

export default async function DemoPage() {
  const user = await getCurrentUser();
  if (!user?.organization.esDemo) notFound();
  const puedeRestaurar = can(user.role, "settings:write") || user.isSuperAdmin;
  const previa = puedeRestaurar ? await vistaPreviaRestauracion(user.organizationId) : null;
  const historias = await Promise.all(ORDEN_RECOMENDADO.map(async (k) => {
    const h = HISTORIAS.find((x) => x.clave === k)!;
    return { ...h, ligas: await ligas(user.organizationId, h) };
  }));
  const zona = user.organization.timezone;

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Guía de la demostración</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cinco historias sobre el sistema real, de 4 a 5 minutos cada una. Orden recomendado para una demostración de 20 a 30 minutos: {ORDEN_RECOMENDADO.map((k) => HISTORIAS.find((h) => h.clave === k)!.titulo.toLowerCase()).join(" → ")}.
        </p>
        <div className="mt-3"><ReiniciarRecorrido /></div>
      </header>

      <section aria-labelledby="cuentas" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="cuentas" className="font-semibold text-slate-900">Cuentas de la demo</h2>
        <p className="mt-1 text-xs text-slate-500">Todas con la misma contraseña, que tiene quien administra las demostraciones.</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {PERSONAS.map((p) => <li key={p.clave}><span className="font-medium">{p.nombre}</span> · {p.puesto} · <span className="font-mono text-xs">{p.clave}@{DEMO.dominio}</span></li>)}
        </ul>
      </section>

      {historias.map((h, i) => (
        <section key={h.clave} id={h.clave} aria-labelledby={`h-${h.clave}`} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Historia {i + 1} · {h.minutos} min · {h.rol}</p>
          <h2 id={`h-${h.clave}`} className="mt-1 text-lg font-semibold text-slate-900">{h.titulo}</h2>
          <dl className="mt-2 grid gap-2 text-sm">
            <div><dt className="inline font-medium text-slate-900">Inicio: </dt><dd className="inline text-slate-700">{h.inicio}</dd></div>
            <div><dt className="inline font-medium text-slate-900">Problema: </dt><dd className="inline text-slate-700">{h.problema}</dd></div>
          </dl>
          <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-sm text-slate-700">{h.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><strong>Resultado que se explica: </strong>{h.resultado}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {h.ligas.filter((l) => l.href && puedeVerRuta(user.role, l.href, { esDemo: true })).map((l) => (
              <Link key={l.etiqueta} href={l.href!} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-brand-700 hover:bg-slate-50">{l.etiqueta}</Link>
            ))}
          </div>
        </section>
      ))}

      <section aria-labelledby="faq" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="faq" className="font-semibold text-slate-900">Preguntas frecuentes de la demo</h2>
        <dl className="mt-2 grid gap-3 text-sm">{PREGUNTAS_DEMO.map((q) => <div key={q.p}><dt className="font-medium text-slate-900">{q.p}</dt><dd className="text-slate-700">{q.r}</dd></div>)}</dl>
      </section>

      <section id="restaurar" aria-labelledby="restaurar-t" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="restaurar-t" className="font-semibold text-slate-900">Restaurar la demo</h2>
        {previa ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Regresa la empresa demostrativa a su estado inicial, con fechas al día. {previa.ultimaRestauracion ? `Última restauración: ${formatDateTime(previa.ultimaRestauracion, zona)}.` : ""}
            </p>
            <PanelRestaurar previa={previa} />
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">La restaura la administración de la demo (dirección o gerencia).</p>
        )}
      </section>
    </div>
  );
}
