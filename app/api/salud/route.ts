import { NextResponse } from "next/server";
import { estadoDeProcesos } from "@/lib/procesos";

export const dynamic = "force-dynamic";

/**
 * ¿Esta sano el sistema? Contesta 200 si si, 503 si no.
 *
 * Existe para que algo de AFUERA pueda preguntarlo, porque un proceso que
 * dejo de correr calla exactamente igual que uno sano: no hay error, no hay
 * registro, no hay nada. La revision de disponibilidad de Google Cloud pega
 * aqui cada cinco minutos y, cuando esto deja de contestar 200, manda el
 * correo. Es el «hombre muerto» del sistema.
 *
 * Que se revisa:
 *  - Que la base conteste, porque para contestar hay que consultarla.
 *  - Que ningun proceso programado lleve mas de tres periodos sin terminar.
 *  - Que ninguno lleve tres fallas seguidas.
 *
 * Sin sesion a proposito: quien vigila es una maquina de Google, no una
 * persona con cuenta. Lo que se devuelve son nombres de procesos y minutos;
 * ningun dato de ninguna empresa.
 */
export async function GET() {
  try {
    const procesos = await estadoDeProcesos();
    const callados = procesos.filter((p) => p.callado);
    const fallando = procesos.filter((p) => p.fallasSeguidas >= 3);
    const sano = callados.length === 0 && fallando.length === 0;

    return NextResponse.json(
      {
        ok: sano,
        revisadoA: new Date().toISOString(),
        callados: callados.map((p) => ({ proceso: p.nombre, desdeMinutos: p.desdeMinutos })),
        fallando: fallando.map((p) => ({ proceso: p.nombre, fallasSeguidas: p.fallasSeguidas })),
      },
      { status: sano ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Si esto revienta es que la base no contesta, que es justo lo que
    // interesa saber. El detalle va al registro, no a la respuesta.
    console.error("[salud]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "No fue posible revisar el estado" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
