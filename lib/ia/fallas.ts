import { prisma } from "../db";
import { notify } from "../audit";

/**
 * Diagnostico de las fallas de la IA.
 *
 * Una llamada que falla no es solo un error tecnico: casi siempre significa
 * que el servicio esta caido para TODOS los clientes a la vez —llave revocada,
 * saldo agotado, configuracion rota— y nadie se entera hasta que un cliente
 * reclama que no llego su reporte del lunes.
 *
 * Aqui se clasifica el motivo a partir del mensaje ya saneado y se avisa al
 * operador de la plataforma. La clasificacion se hace al leer y no al guardar
 * para poder mejorarla despues sin migrar lo ya registrado.
 */

export type ClaseDeFalla = "AUTENTICACION" | "SALDO" | "LIMITE" | "CONFIGURACION" | "OTRA";

export type Diagnostico = {
  clase: ClaseDeFalla;
  titulo: string;
  queHacer: string;
  /** Si amerita interrumpir al operador: son las que dejan el servicio muerto. */
  urgente: boolean;
};

const CATALOGO: Record<ClaseDeFalla, Omit<Diagnostico, "clase">> = {
  AUTENTICACION: {
    titulo: "La llave de Anthropic no es valida",
    queHacer:
      "Revisela en console.anthropic.com. Si fue revocada o reemplazada, genere una nueva y suba una version del secreto cmms-anthropic-key en Secret Manager.",
    urgente: true,
  },
  SALDO: {
    titulo: "Se agotaron los creditos de Anthropic",
    queHacer:
      "Recargue en console.anthropic.com. Conviene dejar activada la recarga automatica para que no vuelva a pasar sin aviso.",
    urgente: true,
  },
  CONFIGURACION: {
    titulo: "Falta configuración para llamar al modelo",
    queHacer:
      "Revise que el servicio tenga ANTHROPIC_API_KEY y, si la llave esta ligada a su identidad, también ANTHROPIC_WORKSPACE_ID.",
    urgente: true,
  },
  LIMITE: {
    titulo: "Se alcanzo el limite de peticiones por minuto",
    queHacer:
      "Es temporal y se resuelve solo. Si se repite cada semana, conviene espaciar el trabajo programado o pedir mas cupo.",
    urgente: false,
  },
  OTRA: {
    titulo: "El modelo devolvio un error",
    queHacer: "Revise el detalle. Si se repite, conviene revisarlo con quien mantiene el sistema.",
    urgente: false,
  },
};

/** Deduce el motivo a partir del texto del error. */
export function clasificarFalla(mensaje: string): Diagnostico {
  const m = mensaje.toLowerCase();
  const clase: ClaseDeFalla =
    /401|authentication_error|invalid x-api-key|invalid bearer|permission_error|403/.test(m)
      ? "AUTENTICACION"
      : /credit balance|insufficient|billing|quota|402|payment/.test(m)
        ? "SALDO"
        : /429|rate.?limit|overloaded|529/.test(m)
          ? "LIMITE"
          : /workspace|no esta configurada|not configured|api key|missing/.test(m)
            ? "CONFIGURACION"
            : "OTRA";
  return { clase, ...CATALOGO[clase] };
}

export type FallaAgrupada = Diagnostico & {
  ocurrencias: number;
  ultima: Date;
  ejemplo: string;
  empresas: string[];
};

/**
 * Fallas ocurridas desde `desde`, agrupadas por motivo.
 *
 * Quien avisa pasa el inicio de su propia corrida, no una ventana de horas: si
 * mirara hacia atras alertaria por incidentes ya resueltos —exactamente lo que
 * hace ruido y ensena al operador a ignorar las alertas—. La pantalla si usa
 * una ventana amplia, porque ahi el proposito es mostrar el historial.
 */
export async function fallasRecientes(desde: Date): Promise<FallaAgrupada[]> {
  const registros = await prisma.aiUsage.findMany({
    where: { ok: false, createdAt: { gte: desde } },
    select: {
      error: true, createdAt: true,
      organization: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const grupos = new Map<ClaseDeFalla, FallaAgrupada>();
  for (const r of registros) {
    const d = clasificarFalla(r.error ?? "");
    const previo = grupos.get(d.clase);
    if (previo) {
      previo.ocurrencias += 1;
      if (!previo.empresas.includes(r.organization.name)) previo.empresas.push(r.organization.name);
    } else {
      grupos.set(d.clase, {
        ...d,
        ocurrencias: 1,
        ultima: r.createdAt,
        ejemplo: r.error ?? "",
        empresas: [r.organization.name],
      });
    }
  }

  // Primero lo que deja el servicio muerto.
  return [...grupos.values()].sort((a, b) => Number(b.urgente) - Number(a.urgente));
}

/**
 * Avisa a los operadores de la plataforma.
 *
 * Se manda un aviso por motivo y no uno por empresa: si la llave murio, las
 * diez empresas fallan por lo mismo y diez notificaciones identicas solo
 * estorban. Y no se repite el aviso del mismo motivo dentro de 24 horas, para
 * que el trabajo semanal no lo llene de duplicados.
 */
export async function avisarDeFallas(fallas: FallaAgrupada[]) {
  const urgentes = fallas.filter((f) => f.urgente);
  if (!urgentes.length) return 0;

  const operadores = await prisma.user.findMany({
    where: { isSuperAdmin: true, active: true },
    select: { id: true, organizationId: true },
  });
  if (!operadores.length) return 0;

  let enviados = 0;
  for (const falla of urgentes) {
    const yaAvisado = await prisma.notification.findFirst({
      where: {
        title: falla.titulo,
        createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
      },
      select: { id: true },
    });
    if (yaAvisado) continue;

    const empresas = falla.empresas.length === 1
      ? falla.empresas[0]
      : `${falla.empresas.length} empresas`;

    await Promise.all(
      operadores.map((o) =>
        notify({
          organizationId: o.organizationId,
          userId: o.id,
          title: falla.titulo,
          body: `El diagnostico fallo en ${empresas}. ${falla.queHacer}`,
          link: "/clients/ia",
          kind: "CRITICAL",
        }),
      ),
    );
    enviados += 1;
  }
  return enviados;
}
