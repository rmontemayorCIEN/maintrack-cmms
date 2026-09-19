import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { SEVERIDADES, SOPORTE } from "@/lib/comercial";
import { ESTADOS_SOPORTE, type EstadoSoporte } from "@/lib/soporte";
import { planDe } from "@/lib/planes";
import { formatDateTime } from "@/lib/utils";
import { FormularioSoporte, Seguimiento } from "./formulario";

export const metadata = { title: "Soporte" };

/** Cómo pedir ayuda a MainTrack, y en qué va lo que ya se pidió. */
export default async function SoportePage({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
  const user = (await getCurrentUser())!;
  const { desde } = await searchParams;
  const todas = can(user.role, "settings:write");
  const plan = user.organization.plan === "ENTERPRISE" ? "ENTERPRISE" : "PROFESSIONAL";
  const solicitudes = await prisma.solicitudSoporte.findMany({
    where: { organizationId: user.organizationId, ...(todas ? {} : { userId: user.id }) },
    orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true } } },
  });
  const zona = user.organization.timezone;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Soporte</h1>
        <p className="mt-1 text-sm text-slate-600">Pida ayuda al equipo de MainTrack desde aquí: cada solicitud recibe un folio y aquí mismo ve su avance.</p>
      </header>

      <section aria-labelledby="como" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h2 id="como" className="font-semibold text-slate-900">Cómo funciona</h2>
        <p><strong>Horario:</strong> {SOPORTE.horario}</p>
        <p><strong>Si no puede entrar:</strong> {SOPORTE.canalAlterno}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-xs">
            <caption className="sr-only">Tiempos objetivo de respuesta para su plan</caption>
            <thead className="text-slate-500"><tr><th className="py-1 pr-3">Severidad</th><th className="py-1 pr-3">Cuándo</th><th className="py-1">Respuesta objetivo · plan {planDe(plan).nombre}</th></tr></thead>
            <tbody>{SEVERIDADES.map((s) => <tr key={s.clave} className="border-t border-slate-100"><td className="py-1.5 pr-3 font-medium">{s.nombre}</td><td className="py-1.5 pr-3">{s.cuando}</td><td className="py-1.5 tabular-nums">{s.respuesta[plan]}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">Se comprometen tiempos de respuesta en horario hábil, no de solución. <Link href="/legal/sla" className="underline" target="_blank">Acuerdo de niveles de servicio</Link> · <Link href="/legal/soporte" className="underline" target="_blank">Política de soporte</Link></p>
        <p className="text-xs text-slate-500">Antes de escribir, quizá le sirva: la ayuda de cada pantalla (botón «?» arriba) y el <Link href="/glossary" className="underline">glosario</Link>.</p>
      </section>

      <section aria-labelledby="nueva" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="nueva" className="font-semibold text-slate-900">Nueva solicitud</h2>
        <FormularioSoporte pantallaInicial={desde?.slice(0, 200) ?? ""} severidades={SEVERIDADES.map((s) => ({ clave: s.clave, nombre: s.nombre, cuando: s.cuando, respuesta: s.respuesta[plan] }))} />
      </section>

      <section aria-labelledby="mias">
        <h2 id="mias" className="font-semibold text-slate-900">{todas ? "Solicitudes de la empresa" : "Mis solicitudes"}</h2>
        {solicitudes.length === 0 ? <p className="mt-2 text-sm text-slate-500">Todavía no hay solicitudes.</p> : (
          <ul className="mt-3 grid gap-3">
            {solicitudes.map((s) => (
              <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900"><span className="font-mono text-xs text-slate-500">{s.folio}</span> · {s.asunto}</p>
                  <span data-estado={s.estado} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">{ESTADOS_SOPORTE[s.estado as EstadoSoporte] ?? s.estado}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{SEVERIDADES.find((x) => x.clave === s.severidad)?.nombre} · {formatDateTime(s.createdAt, zona)}{todas && s.user ? ` · ${s.user.name}` : ""}</p>
                <p className="mt-2 whitespace-pre-wrap text-slate-700">{s.descripcion}</p>
                {s.respuesta ? <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-slate-800"><strong>Respuesta de MainTrack: </strong>{s.respuesta}</p> : null}
                {s.estado !== "CERRADA" && (s.userId === user.id || todas) ? <Seguimiento id={s.id} estado={s.estado} severidad={s.severidad} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
