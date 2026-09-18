"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Avisa cuando el teléfono se queda sin conexión. MainTrack no trabaja sin
 * red: lo que se capture mientras tanto no se ha guardado. Los formularios que
 * usan `useBorrador` conservan lo escrito y se puede reintentar al volver.
 */
export function EstadoConexion() {
  const [enLinea, setEnLinea] = useState(true);
  useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine);
    actualizar();
    window.addEventListener("online", actualizar);
    window.addEventListener("offline", actualizar);
    return () => {
      window.removeEventListener("online", actualizar);
      window.removeEventListener("offline", actualizar);
    };
  }, []);
  if (enLinea) return null;
  return (
    <div role="status" className="sticky top-14 z-20 flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-xs font-medium text-amber-950 no-print">
      <WifiOff className="h-4 w-4 shrink-0" />
      Sin conexión. Lo que capture todavía no se guarda; se conserva en esta pantalla para que lo envíe al volver la señal.
    </div>
  );
}
