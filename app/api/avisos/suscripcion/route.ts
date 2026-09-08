import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { llavePublica, nombrarDispositivo, pushConfigurado } from "@/lib/push";

/**
 * Alta y baja de los aparatos que reciben avisos.
 *
 * Va con `withAuth(null)` —el permiso de lectura— aunque escriba. El motivo:
 * cada quien registra SU propio telefono, no toca datos de nadie mas, y todos
 * los roles necesitan poder hacerlo, incluido quien solo consulta. Ademas, el
 * control comercial de una cuenta vencida no debe impedir el registro: si lo
 * bloqueara, al reactivarse la cuenta nadie estaria suscrito y el silencio se
 * leeria como una falla del sistema.
 */

const suscripcionSchema = z.object({
  suscripcion: z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(300) }),
  }),
  /** Cuando el navegador rota la suscripcion, la anterior que hay que retirar. */
  reemplaza: z.string().max(2000).nullable().optional(),
  /** Si la aplicacion se abrio desde el icono y no desde el navegador. */
  instalada: z.boolean().optional(),
});

/** Que aparatos tiene esta persona y si el canal esta disponible. */
export async function GET() {
  return withAuth(null, async ({ user, orgId }) => {
    const [dispositivos, org] = await Promise.all([
      prisma.pushSubscription.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        // La direccion viaja para que la pantalla pueda marcar cual de los
        // renglones es el aparato que se tiene en la mano. Sin eso, quien usa
        // tres aparatos no sabe cual esta borrando.
        select: {
          id: true, endpoint: true, dispositivo: true,
          createdAt: true, ultimoEnvioAt: true, fallos: true,
        },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { avisosPush: true },
      }),
    ]);

    return ok({
      /** Si el servidor tiene llaves. Sin esto no hay nada que ofrecer. */
      disponible: pushConfigurado(),
      llavePublica: llavePublica(),
      /** Si la organizacion los tiene encendidos. */
      encendido: org?.avisosPush ?? false,
      dispositivos,
    });
  });
}

/** Da de alta este aparato. Repetirlo no duplica: la direccion es unica. */
export async function POST(request: Request) {
  return withAuth(null, async ({ user }) => {
    /**
     * El aparato se registra en la organizacion PROPIA de la persona, no en la
     * que esta viendo.
     *
     * Un superadministrador trabajando dentro de una empresa cliente conserva
     * su usuario pero `orgId` apunta al cliente. Si el telefono se guardara con
     * ese `orgId`, el interruptor de avisos del CLIENTE decidiria si le llegan
     * los avisos de SU PROPIA empresa: el cliente apaga los suyos y el operador
     * de la plataforma deja de recibir los de su cuenta sin entender por que.
     */
    const orgId = user.organizacionPropia.id;
    if (!pushConfigurado()) {
      return fail("Los avisos al celular no están configurados en el servidor.", 503);
    }
    const input = suscripcionSchema.parse(await request.json());
    const userAgent = request.headers.get("user-agent");
    const nombre = nombrarDispositivo(userAgent, input.instalada);

    /**
     * Retirar la suscripcion anterior cuando el navegador la rota.
     *
     * Sin esto la lista de aparatos crece con fantasmas: el mismo telefono
     * aparece cuatro veces y solo el ultimo recibe. La persona ve cuatro
     * renglones y no sabe cual borrar.
     */
    if (input.reemplaza && input.reemplaza !== input.suscripcion.endpoint) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint: input.reemplaza, userId: user.id },
      });
    }

    /**
     * La direccion es unica en todo el sistema, no por usuario.
     *
     * Si un tecnico presta su telefono y otro entra con su cuenta, el aparato
     * debe pasar al segundo, no quedar apuntando al primero: de otro modo le
     * llegarian avisos de ordenes que no son suyas. Por eso el upsert
     * reasigna dueno en lugar de fallar.
     */
    const registro = await prisma.pushSubscription.upsert({
      where: { endpoint: input.suscripcion.endpoint },
      create: {
        organizationId: orgId,
        userId: user.id,
        endpoint: input.suscripcion.endpoint,
        p256dh: input.suscripcion.keys.p256dh,
        auth: input.suscripcion.keys.auth,
        dispositivo: nombre,
        userAgent,
      },
      update: {
        organizationId: orgId,
        userId: user.id,
        p256dh: input.suscripcion.keys.p256dh,
        auth: input.suscripcion.keys.auth,
        dispositivo: nombre,
        userAgent,
        fallos: 0,
      },
      select: { id: true, dispositivo: true, createdAt: true },
    });

    return ok({ dispositivo: registro }, 201);
  });
}

const bajaSchema = z.object({
  /** Uno de los dos: la direccion (desde el propio navegador) o el id (desde la lista). */
  endpoint: z.string().max(2000).optional(),
  id: z.string().max(40).optional(),
});

/** Da de baja un aparato. */
export async function DELETE(request: Request) {
  return withAuth(null, async ({ user }) => {
    const input = bajaSchema.parse(await request.json().catch(() => ({})));
    if (!input.endpoint && !input.id) return fail("Falta indicar cuál dispositivo.", 422);

    // Siempre acotado al usuario de la sesion: nadie da de baja el telefono de
    // otro, ni siquiera conociendo su identificador.
    const { count } = await prisma.pushSubscription.deleteMany({
      where: {
        userId: user.id,
        ...(input.id ? { id: input.id } : { endpoint: input.endpoint }),
      },
    });

    return ok({ dadosDeBaja: count });
  });
}
