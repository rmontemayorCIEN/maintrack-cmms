import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata = { title: "Imprimir puntos de reporte" };
export const dynamic = "force-dynamic";

/**
 * Hoja para imprimir y recortar.
 *
 * Cada tarjeta trae el QR grande, el lugar y una instruccion en lenguaje de
 * quien la va a leer. Sin la instruccion, un QR pegado en la pared no le dice
 * a nadie para que sirve y nadie lo escanea.
 */
export default async function ImprimirPage() {
  const user = await requireUser();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;

  const puntos = await prisma.reportPoint.findMany({
    where: { organizationId: user.organizationId, activo: true },
    orderBy: [{ site: { name: "asc" } }, { nombre: "asc" }],
    include: {
      site: { select: { name: true } },
      location: { select: { name: true } },
      asset: { select: { code: true, name: true } },
    },
  });

  const tarjetas = await Promise.all(
    puntos.map(async (p) => ({
      ...p,
      svg: await QRCode.toString(`${base}/reportar/${p.token}`, {
        type: "svg", margin: 0, errorCorrectionLevel: "M", width: 240,
      }),
    })),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="text-xs text-slate-600">
          {tarjetas.length} {tarjetas.length === 1 ? "punto activo" : "puntos activos"}. Imprima, recorte
          por la línea y pegue cada tarjeta donde la gente la vea cuando algo falle.
        </p>
        {/* Imprimir lo dispara el navegador; no hace falta JavaScript propio
            para algo que el usuario ya sabe hacer con Cmd+P. */}
        <span className="whitespace-nowrap rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
          Imprima con Cmd+P
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tarjetas.map((p) => (
          <article
            key={p.id}
            className="break-inside-avoid rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 text-center"
          >
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">
              {user.organization.name}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">¿Algo no funciona?</h2>
            <p className="mt-0.5 text-sm text-slate-600">Escanee este código y repórtelo</p>

            <div className="mx-auto my-4 w-48 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: p.svg }} />

            <p className="text-base font-semibold text-slate-900">{p.nombre}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {[p.asset ? `${p.asset.code} · ${p.asset.name}` : null, p.location?.name, p.site?.name]
                .filter(Boolean).join(" — ")}
            </p>
            <p className="mt-3 border-t border-slate-200 pt-2 text-[0.6875rem] leading-relaxed text-slate-500">
              No necesita cuenta ni contraseña. Toma treinta segundos y le damos un folio para
              que vea cómo va.
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
