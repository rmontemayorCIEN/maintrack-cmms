import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";

export async function GET() {
  return withAuth(null, async ({ user }) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return ok({ notifications });
  });
}

export async function PATCH() {
  return withAuth(null, async ({ user }) => {
    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return ok({ success: true });
  });
}
