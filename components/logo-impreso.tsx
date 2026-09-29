/**
 * El logotipo de la empresa en los documentos que se imprimen.
 *
 * La empresa ya sube su logotipo en Configuracion → Apariencia, pero solo se
 * veia dentro del sistema. Los papeles que SALEN —la orden que baja a piso, el
 * expediente que ve un auditor— llevaban unicamente el nombre en texto.
 *
 * Va en un componente y no copiado en cada impreso porque son dos hoy y seran
 * mas: si manana cambia el tamano o se decide que tambien lleve el pie, se
 * cambia una vez.
 *
 * Sin logotipo no estorba: no deja hueco ni marco, simplemente no se dibuja.
 */
export function LogoImpreso({ url, nombre }: { url: string | null | undefined; nombre: string }) {
  if (!url) return null;
  return (
    // La altura se acota: un logotipo grande empujaria el resto de la hoja.
    // `object-contain` conserva la proporcion sea cuadrado o alargado.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={nombre}
      className="mr-4 h-14 w-auto max-w-[180px] object-contain"
    />
  );
}
