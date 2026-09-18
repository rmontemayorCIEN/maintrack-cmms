import Link from "next/link";

/**
 * Lo que se le dice a quien reporta sobre sus datos, en el formulario publico.
 *
 * Es corto a proposito: quien esta parado frente a una maquina descompuesta no
 * va a leer tres parrafos. Dice para que se piden los datos, quien los ve y
 * cuanto duran, y enlaza el aviso completo.
 *
 * `url` es el aviso de privacidad propio de la empresa, si lo configuro. Sin
 * el, se enlaza el del sistema, que explica lo mismo con mas detalle.
 */
export function AvisoDeDatos({ url }: { url?: string | null }) {
  return (
    <p className="mt-6 border-t border-slate-200 pt-4 text-[0.6875rem] leading-relaxed text-slate-500">
      Su nombre y su teléfono se piden solo para dar seguimiento a este reporte y
      poder llamarle si hace falta una aclaración. Los ve el personal de
      mantenimiento de esta instalación; no se comparten con nadie más ni se usan
      para enviarle publicidad.{" "}
      <Link href={url || "/privacidad"} className="underline hover:text-slate-700" {...(url ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        Aviso de privacidad
      </Link>
      .
    </p>
  );
}
