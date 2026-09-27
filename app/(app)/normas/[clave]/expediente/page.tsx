import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { expedienteDeNorma } from "@/lib/normas";
import { ETIQUETA_ESTADO_OBLIGACION, LO_QUE_NO_PROMETE } from "@/lib/normas-tipos";
import { ETIQUETA_ESTADO, nombreDeTipo } from "@/lib/vigencias-tipos";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "@/app/(app)/work-orders/[id]/print/print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params;
  return { title: `Expediente ${decodeURIComponent(clave)}` };
}

/**
 * El expediente de una norma para una inspección.
 *
 * Trae lo REAL del periodo —órdenes cerradas, documentos, registros— y no un
 * tablero: lo que un inspector pide es la evidencia. Y dice al final qué quedó
 * sin respaldo, porque esconderlo sería el peor servicio posible: mejor que el
 * cliente lo descubra aquí que enfrente del inspector.
 *
 * El periodo por omisión son doce meses, que es lo que suelen revisar.
 */
export default async function ExpedientePage({
  params, searchParams,
}: {
  params: Promise<{ clave: string }>;
  searchParams: Promise<{ meses?: string }>;
}) {
  const { clave: crudo } = await params;
  const { meses } = await searchParams;
  const clave = decodeURIComponent(crudo);
  const user = await requireUser();
  if (!user.organization.cumplimientoNormas) notFound();

  const cuantos = Math.min(Math.max(Number(meses) || 12, 1), 60);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - cuantos * 30 * 86_400_000);
  const zona = user.organization.timezone;

  const exp = await expedienteDeNorma(user.organizationId, clave, { desde, hasta });
  if (!exp) notFound();

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-slate-900 print:p-0">
      <div className="print:hidden">
        <Link href={`/normas/${encodeURIComponent(clave)}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3" aria-hidden /> Volver a la norma
        </Link>
        <div className="mt-2"><PrintButton /></div>
      </div>

      <header className="mb-6 border-b-2 border-slate-800 pb-4">
        <h1 className="text-xl font-bold">EXPEDIENTE DE CUMPLIMIENTO</h1>
        <p className="mt-1 text-sm font-medium">{exp.norma.clave} — {exp.norma.titulo}</p>
        <p className="text-sm">{user.organization.name}</p>
        <p className="mt-1 text-xs text-slate-600">
          Periodo del {formatDate(desde, zona)} al {formatDate(hasta, zona)}
          {user.organization.codigoFormatoOT ? ` · Formato ${user.organization.codigoFormatoOT}` : ""}
        </p>
      </header>

      <Seccion titulo={`Trabajo realizado (${exp.ordenes.length})`}>
        {exp.ordenes.length ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left uppercase tracking-wide text-slate-500">
                <th className="py-1">Orden</th><th>Trabajo</th><th>Equipo</th><th>Terminada</th><th>Quién</th><th className="text-right">Evidencia</th>
              </tr>
            </thead>
            <tbody>
              {exp.ordenes.map((o) => (
                <tr key={o.id} className="border-b border-slate-100">
                  <td className="py-1 font-medium tabular-nums">{o.number}</td>
                  <td>{o.title}</td>
                  <td className="text-slate-600">{o.asset ? `${o.asset.code} — ${o.asset.name}` : "—"}</td>
                  <td className="tabular-nums text-slate-600">{o.completedAt ? formatDate(o.completedAt, zona) : "—"}</td>
                  <td className="text-slate-600">{o.assignedTo?.name ?? "—"}</td>
                  <td className="text-right tabular-nums text-slate-600">{o._count.attachments || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vacio />}
      </Seccion>

      <Seccion titulo={`Documentos (${exp.documentos.length})`}>
        {exp.documentos.length ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left uppercase tracking-wide text-slate-500">
                <th className="py-1">Documento</th><th>Tipo</th><th>Folio</th><th>Vence</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {exp.documentos.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="py-1 font-medium">{d.titulo}</td>
                  <td className="text-slate-600">{nombreDeTipo(d.tipo)}</td>
                  <td className="text-slate-600">{d.folio ?? "—"}</td>
                  <td className="tabular-nums text-slate-600">{d.hasta ? formatDate(d.hasta, zona) : "no caduca"}</td>
                  <td className="text-slate-600">{ETIQUETA_ESTADO[d.estado]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vacio />}
      </Seccion>

      <Seccion titulo={`Registros del periodo (${exp.registros.length})`}>
        {exp.registros.length ? (
          <ul className="space-y-1 text-xs">
            {exp.registros.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{r.tabla}</span>
                <span className="text-slate-600"> — {r.cuantos} capturas, la última el {r.ultimo ? formatDate(r.ultimo, zona) : "—"}</span>
              </li>
            ))}
          </ul>
        ) : <Vacio />}
      </Seccion>

      {exp.rondines.length ? (
        <Seccion titulo={`Recorridos (${exp.rondines.length})`}>
          <ul className="space-y-1 text-xs">
            {exp.rondines.map((r) => (
              <li key={r.id}>
                <span className="font-medium tabular-nums">Rondín {r.numero}</span>
                <span className="text-slate-600"> — {r.terminadoEn ? `terminado el ${formatDate(r.terminadoEn, zona)}` : r.estado}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      ) : null}

      <Seccion titulo="Estado de cada obligación">
        <table className="w-full text-xs">
          <tbody>
            {exp.norma.obligaciones.map((o) => (
              <tr key={o.id} className="border-b border-slate-100">
                <td className="py-1">{o.titulo}</td>
                <td className="text-right text-slate-600">
                  {ETIQUETA_ESTADO_OBLIGACION[o.estado]}
                  {o.estado === "NO_APLICA" && o.razonNoAplica ? ` — ${o.razonNoAplica}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      {exp.sinRespaldo.length ? (
        <div className="mt-4 border-2 border-slate-800 p-3">
          <p className="text-xs font-bold uppercase">Sin respaldo en el sistema</p>
          <p className="mt-1 text-xs text-slate-600">
            Estas obligaciones no tienen nada amarrado, así que este expediente no las demuestra. Puede que se
            cumplan por fuera; si es así, conviene registrarlo aquí antes de la inspección.
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {exp.sinRespaldo.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      ) : null}

      <footer className="mt-8 border-t border-slate-300 pt-2 text-[0.625rem] text-slate-500">
        {LO_QUE_NO_PROMETE}
      </footer>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-700">{titulo}</h2>
      {children}
    </section>
  );
}

const Vacio = () => <p className="text-xs text-slate-500">Nada en el periodo.</p>;
