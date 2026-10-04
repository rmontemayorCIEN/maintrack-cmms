import Link from "next/link";
import { notFound } from "next/navigation";
import { Play } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { HISTORIAS, ORDEN_RECOMENDADO, PREGUNTAS_DEMO } from "@/lib/demo-guia";
import { armarPresentacion } from "@/lib/demo-presentacion";
import { DEMO, PERSONAS, vistaPreviaRestauracion } from "@/lib/demo-comercial";
import { formatDateTime } from "@/lib/utils";
import { ligasDeHistorias } from "./ligas";
import { PanelRestaurar, ReiniciarRecorrido } from "./panel";

export const metadata = { title: "Guía de la demostración" };

export default async function DemoPage() {
  const user = await getCurrentUser();
  if (!user?.organization.esDemo) notFound();
  const puedeRestaurar = can(user.role, "settings:write") || user.isSuperAdmin;
  const previa = puedeRestaurar ? await vistaPreviaRestauracion(user.organizationId) : null;
  const porHistoria = await ligasDeHistorias(user.organizationId, user.role);
  // La diapositiva de cada caso sale del mismo armado que la presentación:
  // así el botón «Presentar este caso» nunca apunta a la diapositiva de al lado.
  const diapositivas = armarPresentacion();
  const historias = ORDEN_RECOMENDADO.map((k) => {
    const h = HISTORIAS.find((x) => x.clave === k)!;
    return { ...h, ligas: porHistoria[h.clave] ?? [], diapositiva: diapositivas.findIndex((d) => d.clave === `caso-${h.clave}`) + 1 };
  });
  const zona = user.organization.timezone;

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Guía de la demostración</h1>
        <p className="mt-1 text-sm text-slate-600">
          Todo para presentar MainTrack a un cliente: la presentación en diapositivas, las cinco historias sobre el sistema real y cómo dejar la demo como nueva.
        </p>
      </header>

      <section aria-labelledby="presentar" className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <h2 id="presentar" className="font-semibold text-violet-950">Presentar al cliente</h2>
        <p className="mt-1 text-sm text-violet-900">
          {diapositivas.length} diapositivas a pantalla completa, una a la vez: el problema, qué es y qué no es MainTrack, los cinco casos sobre esta empresa —con botones que abren la pantalla real—, la inteligencia artificial, cómo se arranca, los precios y el cierre.
          Se avanza con las flechas del teclado y se sale con Escape.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href="/demo/presentacion" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 font-semibold text-white hover:bg-violet-700">
            <Play className="h-4 w-4" /> Iniciar la presentación
          </Link>
          <ReiniciarRecorrido />
        </div>
      </section>

      <p className="text-sm text-slate-600">
        Orden recomendado de los casos para una demostración de 20 a 30 minutos: {ORDEN_RECOMENDADO.map((k) => HISTORIAS.find((h) => h.clave === k)!.titulo.toLowerCase()).join(" → ")}.
      </p>

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
            <Link href={`/demo/presentacion?d=${h.diapositiva}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-700">
              <Play className="h-3.5 w-3.5" /> Presentar este caso
            </Link>
            {h.ligas.map((l) => (
              <Link key={l.href + l.etiqueta} href={l.href} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-brand-700 hover:bg-slate-50">{l.etiqueta}</Link>
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
