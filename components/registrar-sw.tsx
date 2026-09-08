"use client";

import { useEffect } from "react";

/**
 * Mantiene vivo el service worker de quien ya acepto recibir avisos.
 *
 * No pide permiso ni molesta a nadie: solo vuelve a registrar el archivo en
 * cada carga, para quien YA dijo que si. Ese registro es lo que hace que un
 * arreglo en public/sw.js llegue a los telefonos; sin esto, el service worker
 * que se instalo el dia de la activacion se queda ahi para siempre.
 *
 * A quien no ha aceptado no se le registra nada. Un service worker en el
 * navegador de alguien que no lo pidio es carga que no autorizo.
 */
export function RegistrarSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Si no se puede registrar, la pantalla de Avisos lo dira con detalle.
      // Aqui no hay a quien avisarle: es una tarea de fondo.
    });
  }, []);

  return null;
}
