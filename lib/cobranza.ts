import { prisma } from "./db";
import { COMPLEMENTO_IA, COMPLEMENTOS, planDe } from "./planes";

/**
 * Cobranza manual del servicio.
 *
 * Cada mes se emite un cargo por organizacion segun su plan. El importe se
 * congela al emitir: si el cliente sube de plan a mitad de mes, el cargo ya
 * emitido conserva lo que se le cobro, no lo que cuesta hoy. Cambiar eso
 * despues seria alterar un adeudo ya comunicado.
 */

export const DIAS_PARA_PAGAR = 15;

export function periodoDe(fecha: Date) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

export function nombrePeriodo(periodo: string) {
  const [a, m] = periodo.split("-").map(Number);
  const nombre = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" })
    .format(new Date(a, m - 1, 1));
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

/** Folio consecutivo por organizacion: NC-000001 (nota de cobro). */
async function siguienteFolio(organizationId: string) {
  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { invSequence: { increment: 1 } },
    select: { invSequence: true },
  });
  return `NC-${String(org.invSequence).padStart(6, "0")}`;
}

export type ResultadoEmision = {
  emitidos: number;
  omitidos: Array<{ empresa: string; motivo: string }>;
  detalle: Array<{ empresa: string; folio: string; importe: number }>;
};

/**
 * Emite los cargos de un periodo.
 *
 * Se omiten: la empresa demostrativa y las cuentas internas del operador
 * (nunca generan cargos), las cuentas
 * canceladas, las que siguen en prueba vigente, y las que ya tienen cargo de
 * ese periodo. Es idempotente:
 * volver a ejecutarlo no duplica nada.
 */
export async function emitirCargosDelPeriodo(
  periodo: string,
  opciones: { organizationId?: string } = {},
): Promise<ResultadoEmision> {
  const organizaciones = await prisma.organization.findMany({
    where: opciones.organizationId ? { id: opciones.organizationId } : {},
    select: {
      id: true, name: true, plan: true, status: true, currency: true, trialEndsAt: true,
      iaComplemento: true, registrosPropios: true, cumplimientoNormas: true,
      esDemo: true, cuentaInterna: true,
      invoices: { where: { periodo }, select: { id: true } },
    },
  });

  const resultado: ResultadoEmision = { emitidos: 0, omitidos: [], detalle: [] };
  const [anio, mes] = periodo.split("-").map(Number);
  const emision = new Date(anio, mes - 1, 1);
  const vence = new Date(anio, mes - 1, 1 + DIAS_PARA_PAGAR);

  for (const org of organizaciones) {
    if (org.invoices.length) {
      resultado.omitidos.push({ empresa: org.name, motivo: "Ya tiene cargo de este periodo" });
      continue;
    }
    if (org.esDemo) {
      resultado.omitidos.push({ empresa: org.name, motivo: "Empresa demostrativa: no genera cargos" });
      continue;
    }
    if (org.cuentaInterna) {
      resultado.omitidos.push({ empresa: org.name, motivo: "Cuenta interna del operador: no genera cargos" });
      continue;
    }
    if (org.status === "CANCELLED") {
      resultado.omitidos.push({ empresa: org.name, motivo: "Cuenta cancelada" });
      continue;
    }

    const plan = planDe(org.plan);
    if (plan.precioMensual === 0) {
      resultado.omitidos.push({ empresa: org.name, motivo: `Plan ${plan.nombre}: sin costo` });
      continue;
    }
    if (org.status === "TRIAL" && org.trialEndsAt && org.trialEndsAt > new Date()) {
      resultado.omitidos.push({ empresa: org.name, motivo: "En periodo de prueba vigente" });
      continue;
    }

    // Los complementos contratados son lineas adicionales del mismo cargo
    // mensual: el cliente recibe una sola nota, con el desglose a la vista.
    //
    // Cuales hay y cuanto cuestan lo decide `COMPLEMENTOS` en planes.ts, no
    // este archivo: aqui solo se suman los que la empresa contrato. Uno nuevo
    // se agrega alla y esto no se toca.
    const contratados = COMPLEMENTOS.filter((c) => c.contratado(org));
    const importe = contratados.reduce((t, c) => t + c.precioMensual, plan.precioMensual);
    const concepto = contratados.length
      ? `Servicio MainTrack · Plan ${plan.nombre} + ${contratados.map((c) => c.nombre).join(" + ")} · ${nombrePeriodo(periodo)}`
      : `Servicio MainTrack · Plan ${plan.nombre} · ${nombrePeriodo(periodo)}`;
    // Se conserva porque las facturas ya emitidas la traen y porque separa lo
    // que se gasta en modelo de lo que no.
    const importeIa = org.iaComplemento ? COMPLEMENTO_IA.precioMensual : 0;

    const folio = await siguienteFolio(org.id);
    await prisma.invoice.create({
      data: {
        organizationId: org.id,
        folio,
        periodo,
        concepto,
        plan: org.plan,
        importe,
        importeIa,
        moneda: org.currency,
        emitidaEl: emision,
        venceEl: vence,
      },
    });

    resultado.emitidos += 1;
    resultado.detalle.push({ empresa: org.name, folio, importe });
  }

  return resultado;
}

/** Resumen de adeudo de una organizacion. */
export async function estadoDeCuenta(organizationId: string) {
  const cargos = await prisma.invoice.findMany({
    where: { organizationId },
    orderBy: [{ periodo: "desc" }],
  });

  const hoy = new Date();
  const pendientes = cargos.filter((c) => c.status === "PENDING");
  const vencidos = pendientes.filter((c) => c.venceEl < hoy);

  return {
    cargos,
    saldo: pendientes.reduce((s, c) => s + c.importe, 0),
    vencido: vencidos.reduce((s, c) => s + c.importe, 0),
    pendientes: pendientes.length,
    vencidos: vencidos.length,
    pagadoTotal: cargos.filter((c) => c.status === "PAID").reduce((s, c) => s + c.importe, 0),
  };
}
