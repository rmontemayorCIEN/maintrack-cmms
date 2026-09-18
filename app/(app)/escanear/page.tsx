import { Escaner } from "./escaner";

export const metadata = { title: "Escanear QR" };

/**
 * Escanear el código QR de un equipo o de un punto de reporte. El código lleva
 * al portal del punto, que con sesión ofrece lo que el rol puede hacer con ese
 * equipo (abrirlo, crear una OT, registrar lectura, reportar).
 */
export default function EscanearPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Escanear QR</h1>
      <p className="mb-4 text-sm text-slate-600">Apunte al código del equipo o del punto de reporte. También puede escribir el código del equipo.</p>
      <Escaner />
    </>
  );
}
