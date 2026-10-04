import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MarcoPublico } from "@/components/publico/marco";
import { FormularioContratacion } from "./formulario";
import { altaAbierta } from "@/lib/alta-empresa";
import { COBRO, PRUEBA_DIAS, TEXTO_PRUEBA, precio } from "@/lib/comercial";
import { CLAVES_INSTALACION, INSTALACIONES } from "@/lib/instalaciones";
import { MODOS_DE_INICIO } from "@/lib/modos-inicio";
import { COMPLEMENTO_IA, NOMBRE_RECURSO, ORDEN_PLANES, PLANES } from "@/lib/planes";
import { RANGOS_ACTIVOS } from "@/lib/prospectos";

export const metadata = { title: "Contratar" };

const limiteTexto = (n: number) => (n === Infinity ? "sin límite" : n.toLocaleString("es-MX"));

export default async function ContratarPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  if (await getCurrentUser()) redirect("/settings?s=suscripcion");
  const { plan } = await searchParams;
  const planes = ORDEN_PLANES.map((clave) => {
    const p = PLANES[clave];
    return {
      clave, nombre: p.nombre, descripcion: p.descripcion, precio: precio(p.precioMensual, p.moneda),
      limites: (["users", "assets", "sites", "sensors"] as const).map((r) => `${limiteTexto(p.limites[r])} ${NOMBRE_RECURSO[r]}`)
        .concat(p.limites.storageGb === Infinity ? "almacenamiento sin límite" : `${p.limites.storageGb} GB de almacenamiento`),
    };
  });
  return (
    <MarcoPublico>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Contratar MainTrack</h1>
        <p className="mt-2 text-slate-600">
          {altaAbierta()
            ? `Su cuenta se crea al terminar, con ${TEXTO_PRUEBA} (${PRUEBA_DIAS} días) sin cargos. Después sigue la puesta en marcha guiada.`
            : "Registre su solicitud: el equipo de MainTrack valida los datos, confirma el plan y crea su cuenta. No se hace ningún cobro en este paso."}
        </p>
        <FormularioContratacion
          abierta={altaAbierta()}
          planes={planes}
          planInicial={ORDEN_PLANES.includes(plan as never) ? plan! : "PROFESSIONAL"}
          complemento={{ nombre: COMPLEMENTO_IA.nombre, precio: precio(COMPLEMENTO_IA.precioMensual, COMPLEMENTO_IA.moneda), descripcion: COMPLEMENTO_IA.descripcion }}
          cobro={`${COBRO.periodicidad}, en ${COBRO.moneda.toLowerCase()}. ${COBRO.impuestos} ${COBRO.manual}`}
          prueba={COBRO.prueba}
          instalaciones={CLAVES_INSTALACION.map((c) => ({ clave: c, nombre: INSTALACIONES[c].nombre }))}
          rangos={RANGOS_ACTIVOS}
          modos={MODOS_DE_INICIO.map((m) => ({ modo: m.modo, titulo: m.titulo, texto: m.texto }))}
        />
      </main>
    </MarcoPublico>
  );
}
