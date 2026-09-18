/**
 * Las tres maneras de empezar una empresa, dichas igual en el alta del
 * operador y en la puesta en marcha. Sin dependencias: lo leen las pantallas.
 *
 * Lo que distingue a cada una es QUÉ datos recibe, y eso tiene tres niveles
 * que no se mezclan:
 *
 *  - **Catálogos técnicos indispensables**: unidades de medida, códigos de
 *    falla y causas genéricos, dos especialidades. Sin ellos no se puede
 *    cerrar una orden ni dar de alta una refacción. Toda empresa los recibe.
 *  - **Configuración recomendada**: los catálogos adaptados a su tipo de
 *    instalación, su primer sitio con el nombre de su giro y el almacén
 *    general. Configuración, no datos: ni un activo, orden ni movimiento.
 *  - **Datos de demostración**: equipos, un plan, refacciones y un proveedor
 *    marcados «[DEMO]», registrados como lote y removibles.
 */
export type ModoDeInicio = "VACIA" | "RECOMENDADA" | "DEMO";

export const MODOS_DE_INICIO: Array<{
  modo: ModoDeInicio;
  titulo: string;
  texto: string;
  incluye: string[];
  noIncluye: string[];
}> = [
  {
    modo: "VACIA",
    titulo: "Comenzar vacía",
    texto: "La empresa, su responsable y solo los catálogos técnicos indispensables. Todo lo demás se captura o se importa.",
    incluye: ["La empresa y su responsable", "Unidades de medida", "Códigos de falla y causas genéricos", "Dos especialidades básicas"],
    noIncluye: ["Sitios, almacenes ni catálogos del giro", "Activos, planes, órdenes ni inventario"],
  },
  {
    modo: "RECOMENDADA",
    titulo: "Cargar configuración recomendada",
    texto: "Además, los catálogos adaptados a su tipo de instalación, su primer sitio y el almacén general.",
    incluye: ["Todo lo de «vacía»", "Categorías de activo, fallas, causas, especialidades y servicios de su giro", "Su primer sitio y el almacén general"],
    noIncluye: ["Activos, órdenes, movimientos ni indicadores: nada inventado"],
  },
  {
    modo: "DEMO",
    titulo: "Crear datos de demostración",
    texto: "La configuración recomendada y un juego chico de ejemplo marcado «[DEMO]», para ver el sistema funcionando.",
    incluye: ["Todo lo de «configuración recomendada»", "Tres equipos, un plan con actividades, dos refacciones con existencia y un proveedor, todos con «[DEMO]»"],
    noIncluye: ["Usuarios de ejemplo", "Órdenes cerradas ni indicadores falsos"],
  },
];

/** El nombre anterior de «configuración recomendada», por si llega de una pantalla abierta. */
export function modoDeInicio(m: string): ModoDeInicio | null {
  if (m === "ESTRUCTURA") return "RECOMENDADA";
  return m === "VACIA" || m === "RECOMENDADA" || m === "DEMO" ? m : null;
}
