import { NextResponse } from "next/server";
import { conCandado } from "./procesos";
import { igualSeguro } from "./acceso";

/**
 * Lo que rodea a toda tarea programada: la llave, el candado y el resultado.
 *
 * Estaba copiado en las cuatro rutas de cron, con dos defectos que solo se
 * ven cuando algo falla de noche:
 *
 *  - **Ninguna tenia candado.** Cloud Scheduler reintenta ante un tiempo
 *    agotado, y Cloud Run puede atender el reintento en otra instancia
 *    mientras la primera sigue trabajando.
 *  - **Todas respondian 200 aunque por dentro hubieran fallado.** Cloud
 *    Scheduler marcaba la corrida como exitosa y el fallo no existia para
 *    nadie. El silencio y el exito se veian igual.
 *
 * Ahora una corrida con fallas responde 500: Scheduler la marca fallida, la
 * reintenta —cosa que ya es segura, porque el candado impide que se solapen—
 * y queda a la vista de quien opera.
 */
export async function corridaDeCron(
  request: Request,
  clave: string,
  fn: () => Promise<{ fallas?: number } & Record<string, unknown>>,
  opciones: { minutos?: number } = {},
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  // Comparacion de tiempo constante: la funcion ya existia en lib/acceso.
  if (!secret || !igualSeguro(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const corrida = await conCandado(`cron:${clave}`, fn, opciones).catch((error) => {
    // El candado ya quedo registrado y liberado; aqui solo se contesta.
    const mensaje = error instanceof Error ? error.message : "error desconocido";
    return { corrio: true as const, resultado: { fallas: 1, error: mensaje } };
  });

  if (!corrida.corrio) {
    // Que el reintento encuentre ocupado NO es una falla: es el candado
    // haciendo su trabajo. Se responde 200 para no encender una alarma.
    return NextResponse.json({ corrioA: new Date().toISOString(), omitido: corrida.motivo });
  }

  const cuerpo = { corrioA: new Date().toISOString(), ...corrida.resultado };
  const fallas = Number(corrida.resultado?.fallas ?? 0);
  return NextResponse.json(cuerpo, { status: fallas > 0 ? 500 : 200 });
}
