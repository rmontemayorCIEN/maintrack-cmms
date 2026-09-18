import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Lo que ve quien abre una pantalla que su rol no usa, por liga o escribiendo
 * la dirección. No dice qué hay detrás: solo que no le corresponde y a dónde ir.
 */
export function SinPermiso() {
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500"><Lock className="h-5 w-5" /></span>
      <h1 className="text-base font-semibold text-slate-900">Esta pantalla no es de su rol</h1>
      <p className="text-sm text-slate-600">
        Su usuario no tiene acceso a esta sección. Si la necesita para su trabajo, pídale a la administración de su empresa que revise su rol.
      </p>
      <Link href="/dashboard" className="mt-1 inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
        Ir a mi inicio
      </Link>
    </div>
  );
}
