"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Seguridad y sesiones, en un solo lugar.
 *
 * Lo que aqui se ofrece existe de verdad en el servidor: cerrar las sesiones
 * mueve la fecha de corte de la persona y el token viejo deja de servir; la
 * exportacion pide permiso y queda en la bitacora. Ningun boton de esta
 * pantalla es decorativo.
 */
export function PanelSeguridad({
  puedeExportar,
  ultimoAcceso,
}: {
  puedeExportar: boolean;
  ultimoAcceso: string | null;
}) {
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cerrarTodas() {
    if (!confirm("Se cerrará su sesión en TODOS los dispositivos, incluido este. ¿Continuar?")) return;
    setCerrando(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todas: true }),
      });
      if (!r.ok) {
        setError("No se pudieron cerrar las sesiones. Intente de nuevo.");
        return;
      }
      router.push("/login");
    } finally {
      setCerrando(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <p className="text-xs font-semibold text-slate-800">Sus sesiones</p>
        <p className="mt-1 text-xs text-slate-500">
          La sesión dura siete días en cada dispositivo donde entró. Si perdió el teléfono o dejó
          abierta una computadora, ciérrelas todas: las que sigan abiertas dejan de servir de
          inmediato.
        </p>
        {ultimoAcceso ? (
          <p className="mt-2 text-xs text-slate-500">Último acceso registrado: <span className="text-slate-800">{ultimoAcceso}</span></p>
        ) : null}
        <button
          type="button"
          onClick={cerrarTodas}
          disabled={cerrando}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {cerrando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          Cerrar sesión en todos los dispositivos
        </button>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </Card>

      <Card>
        <p className="text-xs font-semibold text-slate-800">Contraseñas del equipo</p>
        <p className="mt-1 text-xs text-slate-500">
          En <span className="font-medium text-slate-700">Usuarios</span> puede generar una liga de
          restablecimiento para quien perdió su contraseña. La liga vence en una hora, sirve una sola
          vez y, al usarse, cierra las sesiones abiertas de esa persona.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          Cambiar una contraseña —propia o repuesta por administración— también cierra las demás
          sesiones de esa cuenta.
        </p>
      </Card>

      <Card>
        <p className="text-xs font-semibold text-slate-800">Exportar su información</p>
        <p className="mt-1 text-xs text-slate-500">
          Sus datos son suyos y se los puede llevar en CSV cuando quiera. Cada exportación queda
          registrada en la bitacora con quién la hizo.
        </p>
        {puedeExportar ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["Órdenes de trabajo", "/api/export/work-orders"],
              ["Activos", "/api/export/assets"],
              ["Inventario", "/api/export/inventory"],
            ].map(([titulo, ruta]) => (
              <a
                key={ruta}
                href={ruta}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" /> {titulo}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
            Su rol no puede exportar información. Pídalo a un supervisor o a la administración.
          </p>
        )}
      </Card>
    </div>
  );
}
