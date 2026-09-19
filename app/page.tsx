import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MarcoPublico } from "@/components/publico/marco";
import { FormularioDemo } from "@/components/publico/formulario-demo";
import { TablaPlanes, TarjetasPlanes } from "@/components/publico/planes";
import {
  BENEFICIOS_POR_ROL, DESCRIPCION, DIFERENCIADORES, LEMA, MODULOS, NO_ES, PREGUNTAS, PROBLEMAS, RESPALDOS, SOPORTE, SUBLEMA, TEXTO_PRUEBA,
} from "@/lib/comercial";
import { CLAVES_INSTALACION, INSTALACIONES } from "@/lib/instalaciones";
import { RANGOS_ACTIVOS } from "@/lib/prospectos";

export const metadata = { title: { absolute: "MainTrack — gestión y confiabilidad del mantenimiento" }, description: DESCRIPCION };

/** Un recorrido real del sistema, en el orden en que pasa en la planta. */
const FLUJO = [
  { paso: "Alguien reporta", texto: "El operador escanea el QR del equipo y describe la falla, con foto, sin necesidad de cuenta." },
  { paso: "Supervisión decide", texto: "Revisa la solicitud, la convierte en orden de trabajo y la asigna a un técnico con fecha." },
  { paso: "El técnico ejecuta", texto: "Desde su teléfono: actividades, tiempo, refacciones del almacén, lecturas y evidencia." },
  { paso: "Se valida y se cierra", texto: "Supervisión revisa horas, costo, causa y evidencia antes de cerrar." },
  { paso: "Queda en el activo", texto: "El historial, el costo y la falla alimentan los indicadores y el diagnóstico." },
];

const SEGURIDAD = [
  "Cada empresa ve solo su información: toda consulta se filtra por empresa.",
  "Acceso por rol: cada persona ve y hace solo lo de su función.",
  "Los archivos no son públicos; cada descarga se autoriza por unos minutos.",
  "Bitácora de auditoría: quién hizo qué y cuándo.",
  RESPALDOS.diario + " " + RESPALDOS.puntoEnElTiempo,
  `Opera en ${RESPALDOS.ubicacion}`,
];

export default async function Inicio({ searchParams }: { searchParams: Promise<{ origen?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const origen = (await searchParams).origen?.replace(/[^\w.-]/g, "").slice(0, 40);
  const instalaciones = CLAVES_INSTALACION.map((c) => ({ clave: c, nombre: INSTALACIONES[c].nombre }));

  return (
    <MarcoPublico>
      <main>
        {/* 1. Mensaje principal */}
        <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Gestión y confiabilidad del mantenimiento</p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 [text-wrap:balance] sm:text-5xl">{LEMA}</h1>
              <p className="mt-4 max-w-xl text-lg text-slate-600">{SUBLEMA}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="#demostracion" className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 text-base font-semibold text-white hover:bg-brand-700">Solicitar demostración</Link>
                <Link href="#planes" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 text-base font-medium text-slate-800 hover:bg-slate-50">Ver planes · {TEXTO_PRUEBA}</Link>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Qué es</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{DESCRIPCION}</p>
              <p className="mt-4 text-sm font-semibold text-slate-900">Qué no es</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-slate-600">
                {NO_ES.slice(0, 3).map((x) => <li key={x} className="flex gap-2"><span aria-hidden className="text-slate-400">—</span><span>{x.split(":")[0]}.</span></li>)}
              </ul>
            </div>
          </div>
        </section>

        {/* 2. Problema */}
        <section id="problema" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold text-slate-900 [text-wrap:balance]">Lo que cuesta atender el mantenimiento tarde</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROBLEMAS.map((p) => (
              <article key={p.problema} className="rounded-2xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900">{p.problema}</h3>
                <p className="mt-1 text-sm text-slate-600">{p.detalle}</p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-700">{p.respuesta}</p>
                <ul className="mt-2 grid gap-1 text-sm text-slate-700">{p.capacidades.map((c) => <li key={c}>· {c}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>

        {/* 3. Cómo funciona */}
        <section id="como-funciona" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold text-slate-900">Cómo funciona: una falla, de principio a fin</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-5">
              {FLUJO.map((f, i) => (
                <li key={f.paso} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold text-brand-700">Paso {i + 1}</p>
                  <p className="mt-1 font-semibold text-slate-900">{f.paso}</p>
                  <p className="mt-1 text-sm text-slate-600">{f.texto}</p>
                </li>
              ))}
            </ol>
            <p className="mt-6 max-w-3xl text-sm text-slate-600">
              En la demostración se sigue esta historia en el sistema real, con la empresa demostrativa: una fuga en la llenadora que reporta el operador,
              la orden que asigna supervisión, la refacción que sale del almacén y el costo que queda en el expediente del equipo.
            </p>
          </div>
        </section>

        {/* 4. Módulos */}
        <section id="modulos" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold text-slate-900">Módulos</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULOS.map((m) => (
              <div key={m.nombre} className="rounded-xl border border-slate-200 p-4"><p className="font-semibold text-slate-900">{m.nombre}</p><p className="mt-1 text-sm text-slate-600">{m.texto}</p></div>
            ))}
          </div>
        </section>

        {/* 5. Beneficios por rol */}
        <section id="roles" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold text-slate-900">Cada quien, lo suyo</h2>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {BENEFICIOS_POR_ROL.map((b) => (
                <div key={b.rol} className="rounded-xl border border-slate-200 bg-white p-4"><dt className="font-semibold text-slate-900">{b.rol}</dt><dd className="mt-1 text-sm text-slate-600">{b.beneficio}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        {/* 6. Diferenciadores */}
        <section id="diferenciadores" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold text-slate-900">Lo que lo hace distinto</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {DIFERENCIADORES.map((d) => (
              <div key={d.titulo} className="rounded-xl border border-slate-200 p-4"><p className="font-semibold text-slate-900">{d.titulo}</p><p className="mt-1 text-sm text-slate-600">{d.texto}</p></div>
            ))}
          </div>
        </section>

        {/* 7-8. Planes */}
        <section id="planes" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold text-slate-900">Planes</h2>
            <p className="mt-2 text-slate-600">{TEXTO_PRUEBA} para probarlo, sin tarjeta y sin cargos.</p>
            <div className="mt-6"><TarjetasPlanes /></div>
            <h3 className="mt-10 text-lg font-semibold text-slate-900">Comparación</h3>
            <div className="mt-4"><TablaPlanes /></div>
          </div>
        </section>

        {/* 9. Preguntas frecuentes */}
        <section id="preguntas" className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-semibold text-slate-900">Preguntas frecuentes</h2>
          <div className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200">
            {PREGUNTAS.map((q) => (
              <details key={q.p} className="group px-4 py-3">
                <summary className="cursor-pointer list-none py-1 font-medium text-slate-900 marker:hidden">{q.p}</summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{q.r}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 10-11. Seguridad y soporte */}
        <section id="seguridad" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Seguridad y privacidad</h2>
              <ul className="mt-4 grid gap-2 text-sm text-slate-700">{SEGURIDAD.map((s) => <li key={s} className="flex gap-2"><span aria-hidden className="text-brand-600">✓</span>{s}</li>)}</ul>
              <p className="mt-4 text-sm"><Link href="/legal" className="font-medium text-brand-700 hover:underline">Documentos: contrato, términos, privacidad, niveles de servicio y más</Link></p>
            </div>
            <div id="soporte">
              <h2 className="text-2xl font-semibold text-slate-900">Soporte</h2>
              <p className="mt-4 text-sm text-slate-700">{SOPORTE.canal}.</p>
              <p className="mt-2 text-sm text-slate-700">{SOPORTE.horario}</p>
              <p className="mt-2 text-sm text-slate-700">Cada solicitud recibe un folio; los tiempos objetivo de respuesta dependen de la severidad y el plan.</p>
              <p className="mt-4 text-sm"><Link href="/legal/sla" className="font-medium text-brand-700 hover:underline">Acuerdo de niveles de servicio</Link></p>
            </div>
          </div>
        </section>

        {/* 12. Solicitud de demostración, 13. acceso */}
        <section id="demostracion" className="mx-auto grid max-w-6xl scroll-mt-16 gap-8 px-4 py-14 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Vea MainTrack con su problema</h2>
            <p className="mt-3 text-slate-600">Una demostración de 20 a 30 minutos sobre el sistema real, con una empresa de ejemplo, enfocada en lo que hoy le cuesta más.</p>
            <p className="mt-6 text-sm text-slate-600">¿Ya es cliente? <Link href="/login" className="font-medium text-brand-700 hover:underline">Inicie sesión</Link>.</p>
            <p className="mt-2 text-sm text-slate-600">¿Quiere contratar directamente? <Link href="/contratar" className="font-medium text-brand-700 hover:underline">Elija su plan</Link>.</p>
          </div>
          <FormularioDemo instalaciones={instalaciones} rangos={RANGOS_ACTIVOS} origen={origen} />
        </section>
      </main>
    </MarcoPublico>
  );
}
