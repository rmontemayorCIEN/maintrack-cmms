/**
 * Ubicacion geografica de los sitios.
 *
 * Dos usos, y conviene no confundirlos:
 *
 *   El enlace al mapa es comodidad: abre Google Maps con el sitio. Un enlace
 *   no cuesta nada, a diferencia de incrustar el mapa, que se cobra por cada
 *   carga y en un SaaS con varios clientes se acumula sin que nadie lo note.
 *
 *   El contexto ambiental es lo que de verdad rinde. Un compresor en Monterrey
 *   —seco y con polvo— no lleva la misma frecuencia de filtros que uno en la
 *   costa, donde lo que manda es la corrosion salina; y en altura, compresores
 *   y motores de combustion pierden capacidad. Eso cambia el plan, y hasta hoy
 *   la IA lo proponia sin saber donde estaba el equipo.
 *
 * El modelo deduce el clima de la ciudad y las coordenadas. No se le pide que
 * invente proveedores cercanos ni horarios de acceso: eso no lo sabe, y lo que
 * no sabe no debe adivinarlo.
 */

export type SitioUbicado = {
  name: string;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  notasAcceso?: string | null;
};

/** Enlace a Google Maps. Prefiere las coordenadas; si no hay, la direccion. */
export function enlaceMapa(sitio: SitioUbicado): string | null {
  if (sitio.latitud != null && sitio.longitud != null) {
    return `https://www.google.com/maps/search/?api=1&query=${sitio.latitud},${sitio.longitud}`;
  }
  const texto = [sitio.address, sitio.city, sitio.country].filter(Boolean).join(", ");
  return texto ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}` : null;
}

export function tieneUbicacion(sitio: SitioUbicado) {
  return sitio.latitud != null && sitio.longitud != null;
}

/**
 * Contexto geografico para los prompts.
 *
 * Devuelve null cuando no hay nada que aportar, para no meter ruido: un bloque
 * con puros nulos hace que el modelo razone sobre la nada.
 */
export function contextoGeografico(sitios: SitioUbicado[]) {
  const utiles = sitios.filter((s) => s.city || s.latitud != null);
  if (!utiles.length) return null;

  return {
    nota:
      "Deduzca del lugar las condiciones ambientales que afectan el mantenimiento —clima, polvo, salinidad costera, altitud, temperatura extrema— y ajuste frecuencias y modos de falla en consecuencia. No proponga proveedores ni negocios cercanos: no tiene forma de saberlo.",
    sitios: utiles.map((s) => ({
      sitio: s.name,
      ciudad: s.city ?? null,
      pais: s.country ?? null,
      coordenadas: s.latitud != null && s.longitud != null ? `${s.latitud}, ${s.longitud}` : null,
      accesos: s.notasAcceso ?? null,
    })),
  };
}
