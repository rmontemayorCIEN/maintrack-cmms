import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Lock, ShieldCheck, Wrench } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui";
import { MARCA } from "@/lib/comercial";
import { CAMPOS_AUTORIZACION, leerAutorizacion, origenDe, validarAutorizacion } from "@/lib/mcp/oauth";
import { HERRAMIENTAS } from "@/lib/mcp/herramientas";

export const metadata = { title: "Autorizar agente de IA" };
export const dynamic = "force-dynamic";

/**
 * Donde el operador autoriza a un agente de IA (el conector de claude.ai).
 *
 * Tres casos, y ninguno redirige a una direccion sin verificar:
 *
 *  - Sin sesion: al inicio de sesion de siempre, que regresa aqui.
 *  - Con sesion de alguien que NO es operador: se le dice, y no hay boton.
 *    El endpoint que emite el codigo lo vuelve a revisar; esconder el boton
 *    es cortesia, no la guardia.
 *  - Operador: se le muestra quien pide, que puede hacer y que no, y decide.
 */
export default async function AutorizarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const crudos = await searchParams;
  const params = new URLSearchParams();
  for (const c of CAMPOS_AUTORIZACION) {
    const v = crudos[c];
    if (typeof v === "string") params.set(c, v);
  }

  const h = await headers();
  const origen = origenDe(h);
  const peticion = leerAutorizacion(params);
  const v = await validarAutorizacion(peticion, origen);
  if ("fatal" in v) return <Marco><Aviso titulo="No se puede autorizar" texto={v.fatal!} /></Marco>;
  if ("devolver" in v) redirect(v.devolver!);

  const user = await getCurrentUser();
  if (!user) redirect(`/login?siguiente=${encodeURIComponent(`/oauth/autorizar?${params.toString()}`)}`);

  if (!user.isSuperAdmin) {
    return (
      <Marco>
        <Aviso
          titulo="Solo el operador de la plataforma puede autorizar este conector"
          texto={`Inició sesión como ${user.email}, que no es la cuenta del operador. Cierre sesión y entre con la cuenta del operador para continuar.`}
        />
      </Marco>
    );
  }

  const ok = v.ok!;
  return (
    <Marco>
      <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
        <ShieldCheck className="h-4 w-4" /> Acceso de solo lectura
      </div>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">
        «{ok.cliente.nombre}» quiere consultar {MARCA}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Un agente de IA podrá leer cifras agregadas del negocio como operador de la plataforma,
        a nombre de <strong>{user.email}</strong>. Cada consulta queda en la bitácora.
      </p>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Lo que podrá consultar</p>
      <ul className="mt-2 grid gap-1.5 text-sm text-slate-700">
        {HERRAMIENTAS.map((t) => <li key={t.nombre}>• {t.titulo}</li>)}
      </ul>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Lo que no podrá hacer</p>
      <ul className="mt-2 grid gap-1.5 text-sm text-slate-700">
        <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Crear, cambiar ni borrar nada.</li>
        <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Ver registros operativos de las plantas: órdenes, fallas, activos o personas de los clientes.</li>
      </ul>

      <form method="POST" action="/api/oauth/autorizar" className="mt-6 flex gap-2">
        {CAMPOS_AUTORIZACION.map((c) => {
          const valor = params.get(c);
          return valor ? <input key={c} type="hidden" name={c} value={valor} /> : null;
        })}
        <Button type="submit" name="decision" value="permitir">Permitir</Button>
        <Button type="submit" name="decision" value="rechazar" variant="secondary">Rechazar</Button>
      </form>
      <p className="mt-4 text-xs text-slate-500">
        Para desconectarlo después: quite el conector en claude.ai, o use «Cerrar sesión en todos los dispositivos» en Configuración → Seguridad.
      </p>
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white"><Wrench className="h-5 w-5" /></span>
          {MARCA}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">{titulo}</h1>
      <p className="mt-2 text-sm text-slate-600">{texto}</p>
    </>
  );
}
