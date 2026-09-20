/**
 * Estado técnico de avisos e integraciones de TODAS las empresas, para el
 * operador de la plataforma. Solo conteos y estados: ni títulos de avisos, ni
 * destinos, ni datos operativos. Con esto sabe si algo está fallando sin
 * tener que entrar a la empresa. Lo leen la consola del operador y su ruta.
 */
import { prisma } from "../db";
import { estadoDeProcesos } from "../procesos";
import { proveedorDeCorreo } from "./canales";
import { pushConfigurado } from "../push";

export async function estadoTecnicoPlataforma() {
  const hace24 = new Date(Date.now() - 86_400_000);
  const [orgs, fallidas, enCola, webhooks, credenciales, rechazos] = await Promise.all([
    prisma.organization.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true, name: true } }),
    prisma.entregaAviso.groupBy({ by: ["organizationId"], where: { estado: "FALLIDA", updatedAt: { gte: hace24 } }, _count: true }),
    prisma.entregaAviso.groupBy({ by: ["organizationId"], where: { estado: { in: ["PENDIENTE", "EN_REINTENTO"] } }, _count: true }),
    prisma.webhook.groupBy({ by: ["organizationId", "estado"], _count: true }),
    prisma.credencialApi.groupBy({ by: ["organizationId"], where: { estado: "ACTIVA" }, _count: true }),
    prisma.usoApi.groupBy({ by: ["organizationId"], where: { resultado: { in: ["LIMITE", "ERROR"] }, createdAt: { gte: hace24 } }, _count: true }),
  ]);
  const de = <T extends { organizationId: string | null; _count: number }>(g: T[], id: string) => g.filter((x) => x.organizationId === id).reduce((a, x) => a + x._count, 0);
  // Los procesos que corren solos: si uno dejo de correr, el silencio es
  // identico al de un proceso sano. Aqui se ve la diferencia.
  const procesos = await estadoDeProcesos();
  return {
    plataforma: { correo: proveedorDeCorreo() ?? "sin proveedor", navegador: pushConfigurado() ? "configurado" : "sin llaves" },
    procesos,
    empresas: orgs.map((o) => ({
      id: o.id, nombre: o.name,
      entregasFallidas24h: de(fallidas, o.id), enCola: de(enCola, o.id),
      webhooksSuspendidos: webhooks.filter((w) => w.organizationId === o.id && w.estado === "SUSPENDIDO").reduce((a, w) => a + w._count, 0),
      webhooksActivos: webhooks.filter((w) => w.organizationId === o.id && w.estado === "ACTIVO").reduce((a, w) => a + w._count, 0),
      credencialesActivas: de(credenciales, o.id), apiErrores24h: de(rechazos, o.id),
    })).filter((e) => e.entregasFallidas24h || e.enCola || e.webhooksSuspendidos || e.webhooksActivos || e.credencialesActivas || e.apiErrores24h),
  }
}
