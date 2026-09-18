import Link from "next/link";

/**
 * «No encontrado», en español. La de fábrica decía «This page could not be
 * found» y no ofrecía salida. Suele ser una liga a algo que ya no existe o que
 * es de otra empresa (el operador dentro de un cliente, abriendo algo de la suya).
 */
export default function NoEncontrado() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">No encontramos esa página</h1>
        <p className="mt-2 text-sm text-slate-600">
          Puede que el registro se haya eliminado, que la dirección esté incompleta, o que pertenezca a otra empresa
          distinta de la que tiene abierta.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/dashboard" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">Ir al panel</Link>
          <Link href="/notificaciones" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Ver mis avisos</Link>
        </div>
      </div>
    </main>
  );
}
