"use client";

import { SelectorBuscable } from "@/components/selector-buscable";

/**
 * El filtro de refaccion del kardex.
 *
 * Vive aparte porque la pagina es del servidor y el selector necesita estado.
 * Envia el formulario al elegir: en una barra de filtros, obligar a apretar
 * otro boton despues de escoger es un paso de mas.
 */
export function FiltroRefaccion({
  valor,
  refacciones,
}: {
  valor: string;
  refacciones: { id: string; etiqueta: string }[];
}) {
  return (
    <SelectorBuscable
      className="mt-0.5 w-56"
      name="parte"
      valor={valor}
      onCambio={(id) => {
        const campo = document.querySelector<HTMLInputElement>('input[name="parte"]');
        if (campo) campo.value = id;
        campo?.form?.requestSubmit();
      }}
      vacio="Todas"
      marcador="Busque por clave o descripcion"
      opciones={refacciones}
    />
  );
}
