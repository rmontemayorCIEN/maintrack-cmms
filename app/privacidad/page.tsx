export const metadata = { title: "Aviso de privacidad" };

/**
 * El aviso del sistema, para las empresas que no tienen uno propio.
 *
 * Describe lo que MainTrack hace de verdad con los datos de quien reporta, en
 * palabras que se entienden. No pretende sustituir el aviso legal de la
 * empresa: si esta configura el suyo, el formulario enlaza ese en lugar de este.
 */
export default function PrivacidadPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-10">
      <h1 className="text-xl font-semibold text-slate-900">Aviso de privacidad</h1>
      <p className="mt-2 text-sm text-slate-500">
        Cómo se usan los datos de quien reporta una falla desde un código QR.
      </p>

      <section className="mt-6 grid gap-4 text-sm leading-relaxed text-slate-700">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Qué se pide</h2>
          <p className="mt-1">
            Su nombre y su número de teléfono. El correo es opcional. Si adjunta una
            foto, se guarda junto con el reporte. No se le pide ninguna otra información
            y no se crea ninguna cuenta a su nombre.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Para qué se usa</h2>
          <p className="mt-1">
            Únicamente para atender el reporte: ubicar la falla, asignarla a quien
            corresponde y poder llamarle si hace falta una aclaración. También para que
            usted mismo pueda consultar el avance de lo que reportó.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Quién los ve</h2>
          <p className="mt-1">
            El personal de mantenimiento de la instalación donde escaneó el código. Cada
            empresa ve solamente sus propios reportes. No se venden, no se comparten con
            terceros y no se usan para enviarle publicidad.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Cuánto duran</h2>
          <p className="mt-1">
            El reporte queda en el historial de mantenimiento de la empresa, que lo
            conserva mientras le sea útil para dar seguimiento a sus equipos. El
            reconocimiento de su teléfono en este dispositivo —el que le evita teclear
            el folio otra vez— dura noventa días y usted lo puede borrar cuando quiera
            desde «Mis reportes».
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Cómo pedir que se borren</h2>
          <p className="mt-1">
            Diríjase al personal de mantenimiento de la instalación donde reportó: la
            empresa es la responsable de esa información. MainTrack es el sistema que
            ella usa para administrarla.
          </p>
        </div>
      </section>
    </main>
  );
}
