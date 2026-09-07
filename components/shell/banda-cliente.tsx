"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, LogOut } from "lucide-react";

/**
 * Aviso permanente mientras el operador trabaja dentro de una empresa cliente.
 *
 * Es deliberadamente llamativo: confundir los datos de un cliente con los de
 * otro —o con los propios— seria el peor error posible en una plataforma
 * multiempresa. La banda no se puede ocultar, solo salir.
 */
export function BandaCliente({ nombreCliente }: { nombreCliente: string }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await fetch("/api/admin/switch", { method: "DELETE" });
    router.push("/clients");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-950 lg:px-6 no-print">
      <Building2 className="h-4 w-4 shrink-0" />
      <p className="text-xs font-medium">
        Esta viendo los datos de <strong>{nombreCliente}</strong>, no los de su organización.
      </p>
      <button
        type="button"
        onClick={salir}
        disabled={saliendo}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white/70 px-2.5 py-1 text-[0.6875rem] font-medium text-amber-900 hover:bg-white"
      >
        {saliendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
        Salir de la empresa
      </button>
    </div>
  );
}
