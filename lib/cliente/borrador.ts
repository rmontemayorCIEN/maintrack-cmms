"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lo que alguien está escribiendo y todavía no envía: sobrevive a abrir el
 * menú, ir a ver un activo y regresar, recargar, o quedarse sin señal a la
 * mitad. Vive en la pestaña (sessionStorage) y caduca en 12 horas: no se
 * queda en el teléfono indefinidamente, y al enviar se borra.
 *
 * No es para contraseñas ni datos sensibles: solo texto de trabajo.
 */
const VIGENCIA_MS = 12 * 3_600_000;

export function useBorrador<T extends object>(clave: string, inicial: T) {
  const llave = `mt_borrador:${clave}`;
  const [valor, setValor] = useState<T>(inicial);
  const [recuperado, setRecuperado] = useState(false);
  const listo = useRef(false);

  // Se lee después del primer dibujado: el servidor no tiene sessionStorage.
  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(llave);
      if (guardado) {
        const { v, el } = JSON.parse(guardado) as { v: T; el: number };
        if (Date.now() - el < VIGENCIA_MS) { setValor({ ...inicial, ...v }); setRecuperado(true); }
        else sessionStorage.removeItem(llave);
      }
    } catch { /* sin almacenamiento: se trabaja sin borrador */ }
    listo.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llave]);

  useEffect(() => {
    if (!listo.current) return;
    try {
      const vacio = JSON.stringify(valor) === JSON.stringify(inicial);
      if (vacio) sessionStorage.removeItem(llave);
      else sessionStorage.setItem(llave, JSON.stringify({ v: valor, el: Date.now() }));
    } catch { /* lleno o bloqueado */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llave, valor]);

  const limpiar = useCallback(() => {
    try { sessionStorage.removeItem(llave); } catch { /* nada */ }
    setValor(inicial);
    setRecuperado(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llave]);

  return { valor, setValor, limpiar, recuperado };
}

/** El texto de error cuando `fetch` ni siquiera llegó al servidor. */
export const SIN_RED = "No hay conexión. No se guardó; lo que escribió sigue aquí para enviarlo al volver la señal.";
