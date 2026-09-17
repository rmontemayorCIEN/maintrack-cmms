"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * La zona horaria de la empresa, para los componentes que se dibujan en el
 * servidor Y en el navegador.
 *
 * El servidor de produccion corre en UTC y el navegador en la hora de quien
 * mira. Un componente que formatea una fecha sin zona produce un texto en el
 * servidor y otro en el navegador: React lo detecta al hidratar (#418) y la
 * fecha "brinca" al cargar. Con la zona de la empresa los dos dibujan lo mismo.
 */
const ZonaEmpresa = createContext("America/Mexico_City");

export function ZonaEmpresaProvider({ zona, children }: { zona: string; children: ReactNode }) {
  return <ZonaEmpresa.Provider value={zona}>{children}</ZonaEmpresa.Provider>;
}

export function useZona() {
  return useContext(ZonaEmpresa);
}
