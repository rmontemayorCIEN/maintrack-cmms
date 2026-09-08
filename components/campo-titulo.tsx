"use client";

/**
 * Un titulo: se ve de un renglon, pero crece si el texto no cabe.
 *
 * Nace de un problema concreto: "¿Que esta pasando?" en el reporte de falla
 * era un campo de una linea. El tecnico describe la falla desde el celular,
 * el texto se sale por la derecha, y para releer lo que escribio tiene que
 * arrastrar el dedo dentro del campo. Un `input` no puede envolver texto —es
 * su naturaleza—, asi que la unica salida es un campo multilinea.
 *
 * Pero un titulo NO es un parrafo, y por eso no basta con cambiar la etiqueta:
 *
 * - **Enter sigue enviando.** En un campo multilinea, Enter mete un salto de
 *   linea. Quien viene de teclear un titulo y presiona Enter esperando enviar
 *   se queda mirando un formulario que no paso nada. Aqui Enter envia, como
 *   en cualquier campo de una linea.
 * - **No se guardan saltos de linea.** Se quitan tambien al pegar texto: un
 *   folio con un renglon oculto adentro se ve mal en cada listado, en cada
 *   reporte y en cada aviso al celular, y nadie entiende de donde salio.
 *
 * El crecimiento lo hace globals.css con `field-sizing`, mas el respaldo de
 * components/textos-que-crecen.tsx. Aqui no se repite nada de eso.
 */
export function CampoTitulo({
  value,
  onChange,
  onEnter,
  className = "field",
  ...resto
}: {
  value: string;
  onChange: (valor: string) => void;
  /**
   * Que hacer con Enter cuando el campo NO vive dentro de un <form>.
   *
   * Los dialogos que guardan con un boton y no con un envio de formulario
   * necesitan decir aqui a que llamar; si no, Enter solo evitaria el salto de
   * linea y no haria nada, que se siente como que el sistema se colgo.
   */
  onEnter?: () => void;
  className?: string;
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "rows" | "className"
>) {
  return (
    <textarea
      {...resto}
      rows={1}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        e.preventDefault();
        // El formulario se toma del evento y no de una referencia: `ref` es
        // una pieza mas que puede no estar puesta en el momento del toque, y
        // el sintoma seria que Enter no hace nada. `currentTarget` siempre es
        // el campo que recibio la tecla.
        //
        // `requestSubmit` respeta la validacion del navegador —required,
        // minLength— igual que si se hubiera tocado el boton. Un `submit()`
        // a secas se la brincaria.
        const formulario = e.currentTarget.form;
        if (formulario) formulario.requestSubmit();
        else onEnter?.();
      }}
    />
  );
}
