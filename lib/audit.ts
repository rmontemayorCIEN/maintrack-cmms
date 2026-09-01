import { prisma } from "./db";

export async function logAudit(params: {
  organizationId: string;
  userId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  summary?: string;
  changes?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        summary: params.summary,
        changes: JSON.stringify(params.changes ?? {}),
      },
    });
  } catch {
    // La bitacora nunca debe romper la operacion de negocio.
  }
}

export async function notify(params: {
  organizationId: string;
  userId: string;
  title: string;
  body?: string;
  link?: string;
  kind?: string;
}) {
  try {
    await prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title,
        body: params.body,
        link: params.link,
        kind: params.kind ?? "INFO",
      },
    });
  } catch {
    /* noop */
  }
}
