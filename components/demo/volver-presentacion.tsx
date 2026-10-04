"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Play } from "lucide-react";

/** Dónde se quedó la presentación, para poder volver. Vive en esta pestaña. */
export const LLAVE_PRESENTACION = "mt_presentacion";

export function recordarPresentacion(d: number, titulo: string) {
  try { sessionStorage.setItem(LLAVE_PRESENTACION, JSON.stringify({ d, titulo })); } catch { /* sin almacenamiento: no se ofrece el regreso */ }
}
export function olvidarPresentacion() {
  try { sessionStorage.removeItem(LLAVE_PRESENTACION); } catch { /* nada que olvidar */ }
}

/**
 * El camino de regreso a la presentación.
 *
 * Desde una diapositiva de caso se abre la pantalla real del sistema, y ahí
 * el cliente ya está viendo otra cosa: el «Atrás» del navegador funciona,
 * pero solo si nadie tocó nada en el camino, que es justo lo que pasa en una
 * demostración. Por eso la banda de la demo ofrece volver al punto exacto
 * mientras haya una presentación abierta en esta pestaña.
 */
export function VolverAPresentacion() {
  const pathname = usePathname();
  const [donde, setDonde] = useState<{ d: number; titulo: string } | null>(null);

  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(LLAVE_PRESENTACION);
      setDonde(guardado ? JSON.parse(guardado) : null);
    } catch { setDonde(null); }
  }, [pathname]);

  if (!donde || pathname === "/demo/presentacion") return null;

  return (
    <Link
      href={`/demo/presentacion?d=${donde.d}`}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 font-semibold text-white hover:bg-violet-700"
    >
      <Play className="h-3 w-3" />
      Volver a la presentación
      <span className="hidden sm:inline font-normal opacity-90">· {donde.titulo}</span>
    </Link>
  );
}
