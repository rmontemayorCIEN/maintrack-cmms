/**
 * Como se acota una lista de trabajo: por responsable, por tipo, por familia
 * de equipo o por equipos concretos.
 *
 * Vive aqui, y no dentro de una pantalla, porque lo usan el Calendario y el
 * Tablero. Copiarlo seria garantizar que un dia filtren distinto: quien acota
 * el calendario a «compresores» espera que el tablero entienda lo mismo, y dos
 * pantallas que responden distinto a la misma pregunta no se pueden defender.
 *
 * Sin dependencias de servidor: lo importan componentes de cliente.
 */

export type FiltroTrabajo = {
  /** Id del responsable, o `SIN_RESPONSABLE` para las que no tienen. */
  tecnico: string;
  /** PREVENTIVE | CORRECTIVE | … */
  tipo: string;
  /** Id de la categoria de activo. */
  familia: string;
  /** Ids de equipos concretos. Mandan sobre la familia. */
  equipos: string[];
};

export const SIN_RESPONSABLE = "__sin";

export const FILTRO_VACIO: FiltroTrabajo = { tecnico: "", tipo: "", familia: "", equipos: [] };

export function hayFiltro(f: FiltroTrabajo) {
  return Boolean(f.tecnico || f.tipo || f.familia || f.equipos.length);
}

/**
 * Si el equipo entra en la seleccion.
 *
 * Los equipos elegidos MANDAN sobre la familia: si alguien escogio tres
 * compresores concretos, no tiene sentido que la familia se los quite.
 */
export function enSeleccion(f: FiltroTrabajo, assetId?: string | null, categoryId?: string | null) {
  if (f.equipos.length) return !!assetId && f.equipos.includes(assetId);
  if (f.familia) return categoryId === f.familia;
  return true;
}

/** Lo que tiene que saberse de una orden para poder filtrarla. */
export type Filtrable = {
  maintenanceType?: string | null;
  responsableId?: string | null;
  assetId?: string | null;
  categoryId?: string | null;
};

export function coincide(f: FiltroTrabajo, o: Filtrable) {
  if (f.tecnico === SIN_RESPONSABLE) {
    if (o.responsableId) return false;
  } else if (f.tecnico && o.responsableId !== f.tecnico) {
    return false;
  }
  if (f.tipo && o.maintenanceType !== f.tipo) return false;
  return enSeleccion(f, o.assetId, o.categoryId);
}
