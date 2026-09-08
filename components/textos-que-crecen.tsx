"use client";

import { useEffect } from "react";

/**
 * Los campos multilinea crecen con lo que se escribe.
 *
 * Un cuadro de dos renglones donde alguien describe una falla obliga a
 * desplazarse dentro del propio campo para releer lo que acaba de escribir, y
 * en el telefono eso es pelearse con el dedo.
 *
 * Se monta UNA vez y escucha en el documento, en lugar de tocar los diecisiete
 * campos que hay hoy. Ese es el punto: el que se agregue manana lo hereda sin
 * que nadie se acuerde de nada.
 *
 * Hace dos cosas, y solo la segunda es un respaldo:
 *
 * 1. **Siempre**: fija el alto minimo a partir de `rows`. Hace falta porque
 *    `field-sizing: content` deja de mirar ese atributo, y un campo vacio se
 *    encogia a UN renglon. Un cuadro de una linea no invita a escribir un
 *    parrafo, asi que eso habria sido un retroceso disfrazado de mejora.
 *
 * 2. **Solo donde el navegador no sabe hacerlo** —Firefox, Safari anterior a
 *    la 18.4—: ajusta el alto al contenido. Donde si sabe, lo hace el CSS de
 *    globals.css, que ademas funciona cuando el valor lo pone el sistema: una
 *    descripcion que redacto la IA, un formulario que abre con datos cargados.
 */

/** El mismo tope que el CSS: sin el, el boton de guardar se sale de pantalla. */
const tope = () => Math.round(window.innerHeight * 0.4);

const NATIVO = () =>
  typeof CSS !== "undefined" && Boolean(CSS.supports?.("field-sizing", "content"));

/**
 * El piso, a partir de `rows`.
 *
 * Se calcula una sola vez por campo —queda marcado— porque leer estilos
 * calculados obliga al navegador a recalcular la pagina, y hacerlo en cada
 * tecla se siente.
 */
function fijarMinimo(campo: HTMLTextAreaElement) {
  if (campo.dataset.altoMinimo) return;
  const filas = campo.rows > 0 ? campo.rows : 2;
  const estilo = getComputedStyle(campo);
  const alturaLinea =
    parseFloat(estilo.lineHeight) || parseFloat(estilo.fontSize) * 1.5;
  const extra =
    parseFloat(estilo.paddingTop) + parseFloat(estilo.paddingBottom) +
    parseFloat(estilo.borderTopWidth) + parseFloat(estilo.borderBottomWidth);
  campo.style.minHeight = `${Math.round(filas * alturaLinea + extra)}px`;
  campo.dataset.altoMinimo = "1";
}

function ajustar(campo: HTMLTextAreaElement) {
  fijarMinimo(campo);
  if (NATIVO()) return;
  // Se encoge primero: sin esto el campo solo crece y nunca vuelve a bajar
  // cuando la persona borra lo que habia escrito.
  campo.style.height = "auto";
  const limite = tope();
  campo.style.height = `${Math.min(campo.scrollHeight, limite)}px`;
  // Pasado el tope se desplaza por dentro, como cualquier campo normal.
  campo.style.overflowY = campo.scrollHeight > limite ? "auto" : "hidden";
}

function ajustarTodos(raiz: ParentNode) {
  raiz.querySelectorAll?.("textarea").forEach((c) => ajustar(c as HTMLTextAreaElement));
}

export function TextosQueCrecen() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const alEscribir = (evento: Event) => {
      if (evento.target instanceof HTMLTextAreaElement) ajustar(evento.target);
    };
    // En captura: algunos componentes detienen la propagacion del evento y sin
    // esto sus campos serian los unicos que no crecen.
    document.addEventListener("input", alEscribir, true);

    /**
     * Los campos que aparecen despues: dialogos, filas que se agregan.
     *
     * Sin esto, un formulario que abre con texto ya cargado —editar una orden—
     * se ve del tamano de siempre hasta que la persona toca una tecla.
     */
    const observador = new MutationObserver((cambios) => {
      for (const cambio of cambios) {
        cambio.addedNodes.forEach((nodo) => {
          if (nodo instanceof HTMLTextAreaElement) ajustar(nodo);
          else if (nodo instanceof HTMLElement) ajustarTodos(nodo);
        });
      }
    });
    observador.observe(document.body, { childList: true, subtree: true });

    const id = requestAnimationFrame(() => ajustarTodos(document));

    // Al girar el telefono cambia el ancho y el texto reacomoda sus renglones.
    const alRedimensionar = () => {
      if (NATIVO()) return;
      document.querySelectorAll("textarea").forEach((c) => ajustar(c as HTMLTextAreaElement));
    };
    window.addEventListener("resize", alRedimensionar);

    return () => {
      document.removeEventListener("input", alEscribir, true);
      observador.disconnect();
      cancelAnimationFrame(id);
      window.removeEventListener("resize", alRedimensionar);
    };
  }, []);

  return null;
}
