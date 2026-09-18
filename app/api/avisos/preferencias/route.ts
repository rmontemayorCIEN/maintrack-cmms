import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { EVENTOS, esTipoEvento } from "@/lib/avisos/catalogo";
import { leerJson } from "@/lib/avisos/config";

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const schema = z.object({
  canales: z.array(z.enum(["NAVEGADOR", "CORREO"])).optional(),
  tiposApagados: z.array(z.string()).max(100).optional(),
  resumenDiario: z.boolean().optional(),
  resumenSemanal: z.boolean().optional(),
  horaInicio: hora.nullable().optional(),
  horaFin: hora.nullable().optional(),
  sitios: z.array(z.string()).max(100).optional(),
  navegadorRechazado: z.boolean().optional(),
});

/**
 * Las preferencias de avisos de quien tiene la sesión. Son suyas y de su
 * empresa: no hay forma de leer ni cambiar las de otra persona por aquí.
 */
export async function GET() {
  return withAuth(null, async ({ user }) => {
    const p = await prisma.preferenciaAvisos.findUnique({ where: { userId: user.id } });
    return ok({
      canales: leerJson<string[]>(p?.canales, ["NAVEGADOR", "CORREO"]),
      tiposApagados: leerJson<string[]>(p?.tiposApagados, []),
      resumenDiario: p?.resumenDiario ?? true,
      resumenSemanal: p?.resumenSemanal ?? true,
      horaInicio: p?.horaInicio ?? null,
      horaFin: p?.horaFin ?? null,
      sitios: leerJson<string[]>(p?.sitios, []),
      navegadorRechazado: p?.navegadorRechazado ?? false,
    });
  }, { esLectura: true });
}

export async function PUT(request: Request) {
  return withAuth(null, async ({ user }) => {
    const input = schema.parse(await request.json());
    // Lo obligatorio no se apaga: se ignora y se dice.
    let ignorados: string[] = [];
    let tiposApagados: string[] | undefined;
    if (input.tiposApagados) {
      const validos = input.tiposApagados.filter(esTipoEvento);
      ignorados = validos.filter((t) => EVENTOS[t].categoria === "OBLIGATORIO");
      tiposApagados = validos.filter((t) => EVENTOS[t].categoria !== "OBLIGATORIO");
    }
    // Son de su propia empresa: el operador trabajando dentro de un cliente
    // sigue siendo miembro de la suya.
    const propia = user.organizacionPropia.id;
    // Los sitios tienen que ser de su empresa.
    let sitios: string[] | undefined;
    if (input.sitios) {
      sitios = (await prisma.site.findMany({ where: { organizationId: propia, id: { in: input.sitios } }, select: { id: true } })).map((s) => s.id);
    }
    const datos = {
      ...(input.canales ? { canales: JSON.stringify(input.canales) } : {}),
      ...(tiposApagados ? { tiposApagados: JSON.stringify(tiposApagados) } : {}),
      ...(input.resumenDiario !== undefined ? { resumenDiario: input.resumenDiario } : {}),
      ...(input.resumenSemanal !== undefined ? { resumenSemanal: input.resumenSemanal } : {}),
      ...(input.horaInicio !== undefined ? { horaInicio: input.horaInicio } : {}),
      ...(input.horaFin !== undefined ? { horaFin: input.horaFin } : {}),
      ...(sitios ? { sitios: JSON.stringify(sitios) } : {}),
      ...(input.navegadorRechazado !== undefined ? { navegadorRechazado: input.navegadorRechazado } : {}),
    };
    await prisma.preferenciaAvisos.upsert({
      where: { userId: user.id },
      create: { organizationId: propia, userId: user.id, ...datos },
      update: datos,
    });
    // El permiso del navegador lo decide el navegador, no la persona en esta pantalla: no se audita.
    const soloNavegador = Object.keys(datos).length === 1 && "navegadorRechazado" in datos;
    if (!soloNavegador) {
      await logAudit({
        organizationId: propia, userId: user.id, entity: "User", entityId: user.id,
        action: "NOTIFICATION_PREFERENCES_CHANGED",
        summary: `${user.name} cambió sus preferencias de avisos`,
        changes: { ...input, ...(ignorados.length ? { obligatoriosIgnorados: ignorados } : {}) },
      });
    }
    return ok({ ok: true, ignorados });
  });
}
