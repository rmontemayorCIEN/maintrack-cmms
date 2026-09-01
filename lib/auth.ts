import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE = "mt_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET no esta configurado");
  return new TextEncoder().encode(value);
}

export type SessionPayload = {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  /** Empresa cliente en la que el operador de la plataforma esta trabajando.
   *  Solo tiene efecto si el usuario es superadministrador. */
  actingOrganizationId?: string;
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Sesion + usuario y organizacion frescos desde la base de datos.
 *
 * Si un superadministrador esta trabajando dentro de una empresa cliente, se
 * devuelve su usuario con `organizationId` y `organization` reemplazados por
 * los de esa empresa. Asi TODA la aplicacion —consultas, permisos, reportes—
 * queda automaticamente acotada al cliente correcto, sin tocar cada pantalla.
 *
 * `actuandoComoCliente` permite a la interfaz avisar de forma visible en que
 * empresa se esta parado, para no confundir datos de un cliente con otro.
 */
export async function getCurrentUser() {
  const session = await readSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { organization: true },
  });
  if (!user || !user.active) return null;

  const destino = session.actingOrganizationId;
  if (!destino || destino === user.organizationId) {
    return { ...user, rolPropio: user.role, actuandoComoCliente: false as const, organizacionPropia: user.organization };
  }

  // La suplantacion se revalida contra la base en cada peticion: si se le
  // retira el privilegio, la sesion deja de servir de inmediato.
  if (!user.isSuperAdmin) {
    return { ...user, rolPropio: user.role, actuandoComoCliente: false as const, organizacionPropia: user.organization };
  }

  const cliente = await prisma.organization.findUnique({ where: { id: destino } });
  if (!cliente) {
    return { ...user, rolPropio: user.role, actuandoComoCliente: false as const, organizacionPropia: user.organization };
  }

  return {
    ...user,
    organizationId: cliente.id,
    organization: cliente,
    // Dentro de una empresa cliente, el operador trabaja con permisos plenos.
    role: "OWNER",
    rolPropio: user.role,
    actuandoComoCliente: true as const,
    organizacionPropia: user.organization,
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
