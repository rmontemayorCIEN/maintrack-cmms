import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MAINTENANCE_TYPE_LABELS, PRIORITY_LABELS, WO_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, formatDia } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orden de trabajo (impresion)" };

/** Formato imprimible / vale de trabajo para el tecnico en piso. */
export default async function PrintWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const zona = user.organization.timezone || "America/Mexico_City";
  const wo = await prisma.workOrder.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      asset: true,
      site: true,
      location: true,
      assignedTo: true,
      tasks: { orderBy: { position: "asc" } },
      partsUsed: { include: { part: true } },
      servicesUsed: { include: { supplier: true } },
    },
  });
  if (!wo) notFound();

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-slate-900 print:p-0">
      <PrintButton />

      <header className="mb-6 flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold">ORDEN DE TRABAJO</h1>
          <p className="mt-1 text-sm">{user.organization.name}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">{wo.number}</p>
          <p className="text-xs">{formatDate(wo.createdAt, zona)}</p>
        </div>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <Field label="Tipo" value={MAINTENANCE_TYPE_LABELS[wo.maintenanceType]} />
        <Field label="Prioridad" value={PRIORITY_LABELS[wo.priority]} />
        <Field label="Estado" value={WO_STATUS_LABELS[wo.status]} />
        <Field label="Fecha compromiso" value={formatDia(wo.dueDate, { zona })} />
        <Field label="Activo" value={wo.asset ? `${wo.asset.code} — ${wo.asset.name}` : "—"} />
        <Field label="Ubicacion" value={[wo.site?.name, wo.location?.name].filter(Boolean).join(" / ") || "—"} />
        <Field label="Responsable" value={wo.assignedTo?.name ?? "Sin asignar"} />
        <Field label="Horas estimadas" value={`${formatNumber(wo.estimatedHours, 1)} h`} />
      </section>

      <section className="mb-5">
        <h2 className="mb-1 text-sm font-bold uppercase">Descripción</h2>
        <p className="whitespace-pre-wrap border border-slate-300 p-3 text-sm">{wo.description || "—"}</p>
      </section>

      {wo.safetyNotes ? (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-bold uppercase">Seguridad</h2>
          <p className="whitespace-pre-wrap border-2 border-slate-800 bg-slate-50 p-3 text-sm font-medium">
            {wo.safetyNotes}
          </p>
        </section>
      ) : null}

      {wo.procedure ? (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-bold uppercase">Procedimiento</h2>
          <p className="whitespace-pre-wrap border border-slate-300 p-3 text-sm">{wo.procedure}</p>
        </section>
      ) : null}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-bold uppercase">Lista de verificación</h2>
        {wo.tasks.length === 0 ? (
          <p className="text-sm">Sin tareas.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left">#</th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left">Tarea</th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-left">Resultado</th>
                <th className="border border-slate-300 bg-slate-100 p-2 text-center">OK</th>
              </tr>
            </thead>
            <tbody>
              {wo.tasks.map((task, index) => (
                <tr key={task.id}>
                  <td className="border border-slate-300 p-2">{index + 1}</td>
                  <td className="border border-slate-300 p-2">{task.title}</td>
                  <td className="border border-slate-300 p-2">
                    {task.resultNumber ?? task.resultText ?? ""}
                    {task.unit ? ` ${task.unit}` : ""}
                  </td>
                  <td className="border border-slate-300 p-2 text-center">{task.done ? "✓" : "☐"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {wo.partsUsed.length ? (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold uppercase">Refacciones utilizadas</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {wo.partsUsed.map((item) => (
                <tr key={item.id}>
                  <td className="border border-slate-300 p-2">{item.part.code}</td>
                  <td className="border border-slate-300 p-2">{item.part.name}</td>
                  <td className="border border-slate-300 p-2 text-right">
                    {formatNumber(item.quantity, 2)} {item.part.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {wo.servicesUsed.length ? (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold uppercase">Servicios externos contratados</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {wo.servicesUsed.map((item) => (
                <tr key={item.id}>
                  <td className="border border-slate-300 p-2">{item.descripcion}</td>
                  <td className="border border-slate-300 p-2">{item.supplier?.name ?? "—"}</td>
                  <td className="border border-slate-300 p-2">{item.folioProveedor ?? ""}</td>
                  <td className="border border-slate-300 p-2 text-right">{formatNumber(item.quantity, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="mt-10 grid grid-cols-2 gap-8 text-sm">
        <div>
          <div className="h-16 border-b border-slate-800" />
          <p className="mt-1 text-center text-xs">Ejecuto el trabajo</p>
        </div>
        <div>
          <div className="h-16 border-b border-slate-800" />
          <p className="mt-1 text-center text-xs">Supervisó / Recibió conforme</p>
        </div>
      </section>

      <footer className="mt-8 border-t border-slate-300 pt-2 text-[0.625rem] text-slate-500">
        Impreso {formatDateTime(new Date(), zona)} · MainTrack
      </footer>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.625rem] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p>{value}</p>
    </div>
  );
}
