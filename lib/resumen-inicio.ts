import { after } from "next/server";
import { prisma } from "./db";
import { conCandado } from "./procesos";

/**
 * Lo caro del inicio, calculado cada cuarto de hora en vez de en cada carga.
 *
 * ── Por que solo estas dos cosas ──
 *
 * Midiendo pieza por pieza el inicio de una empresa con un año de operacion,
 * el 98 % del costo estaba en dos: los indicadores del periodo (617 ms) y la
 * revision de calidad de datos (363 ms). Lo demas —vencidas, criticas,
 * refacciones agotadas, compras por firmar— son conteos y cuestan entre cero
 * y nueve milisegundos con los indices que ya existen.
 *
 * Y resulta que esas dos son justo las que NO se mueven: son ventanas de 30 y
 * 90 dias. Con quinientas ordenes juzgadas, cerrar una mueve el cumplimiento
 * dos decimas; la disponibilidad se calcula sobre miles de horas-equipo. Asi
 * que congelarlas un cuarto de hora no se nota, y lo dinamico —que es lo que
 * hay que ver hoy— se sigue consultando en vivo, porque ya es gratis.
 *
 * ── Por que al abrir y no con el proceso de cada hora ──
 *
 * Con un proceso programado, las empresas que nadie abre pagan igual, el
 * primero que entra en la mañana ve lo que se calculo de madrugada, y si el
 * proceso se cae el inicio se queda con cifras viejas sin que nadie lo note.
 * Asi, el propio uso lo mantiene al dia: quien llega y encuentra el resumen
 * vencido NO espera —se le entrega el guardado— y el recalculo ocurre despues
 * de contestarle, con `after`.
 */

/** Cuanto vale un resumen antes de volver a calcularlo. */
export const FRESCURA_MINUTOS = 15;

export type ReglaDeCaptura = {
  clave: string; titulo: string; porque: string;
  nivel: string; cantidad: number; enlace: string; peso: number;
};

export type DatosDeResumen = {
  /** Del periodo de 30 dias. Nulo cuando no hay con que calcularlo. */
  cumplimiento: number | null;
  disponibilidad: number | null;
  costoTotal: number;
  /** Reglas de captura incumplidas, de mayor a menor peso. */
  problemas: ReglaDeCaptura[];
};

const VACIO: DatosDeResumen = { cumplimiento: null, disponibilidad: null, costoTotal: 0, problemas: [] };

/** Calcula de verdad. Es lo unico caro de aqui. */
async function calcular(organizationId: string, ahora: Date): Promise<DatosDeResumen> {
  const [{ calcularIndicadores, periodoDeLaEmpresa }, { revisarCalidad }] = await Promise.all([
    import("./indicadores"), import("./calidad-datos"),
  ]);
  const periodo = await periodoDeLaEmpresa(organizationId, 30, ahora);
  const [kpi, calidad] = await Promise.all([
    calcularIndicadores(organizationId, periodo, { ahora }),
    revisarCalidad(organizationId, ahora).catch(() => []),
  ]);
  return {
    cumplimiento: kpi.indicadores.cumplimientoPreventivo.valor,
    disponibilidad: kpi.indicadores.disponibilidad.valor,
    costoTotal: kpi.costos.total,
    // Sin `hallazgos`: el inicio muestra el titulo y cuantos son, y quien
    // quiere ver cuales va a la puesta en marcha, que los calcula en vivo.
    problemas: calidad
      .filter((r) => r.cantidad > 0)
      .sort((a, b) => b.peso - a.peso)
      .map((r) => ({ clave: r.clave, titulo: r.titulo, porque: r.porque, nivel: r.nivel, cantidad: r.cantidad, enlace: r.enlace, peso: r.peso })),
  };
}

async function guardar(organizationId: string, datos: DatosDeResumen, calculadoEl: Date) {
  await prisma.resumenInicio.upsert({
    where: { organizationId },
    create: { organizationId, calculadoEl, datos: JSON.stringify(datos) },
    update: { calculadoEl, datos: JSON.stringify(datos) },
  });
}

/**
 * El resumen del inicio, recien calculado o del guardado.
 *
 * `calculadoEl` viaja para que la pantalla pueda decir de cuando son las
 * cifras: un numero sin fecha, cuando uno acaba de cerrar cinco ordenes y no
 * se movio, destruye la confianza mas rapido que la espera que evitamos.
 */
export async function resumenDeInicio(
  organizationId: string,
  ahora = new Date(),
): Promise<{ datos: DatosDeResumen; calculadoEl: Date }> {
  const guardado = await prisma.resumenInicio.findUnique({ where: { organizationId } });
  const vencido = !guardado || ahora.getTime() - guardado.calculadoEl.getTime() > FRESCURA_MINUTOS * 60_000;

  // La primera vez no hay nada que enseñar: toca esperar.
  if (!guardado) {
    const datos = await calcular(organizationId, ahora).catch(() => VACIO);
    await guardar(organizationId, datos, ahora).catch(() => undefined);
    return { datos, calculadoEl: ahora };
  }

  const datos = leer(guardado.datos);
  if (!vencido) return { datos, calculadoEl: guardado.calculadoEl };

  /**
   * Recalcular DESPUES de contestarle a esta persona, no antes: el que llega
   * cuando el resumen vencio no tiene por que pagar la espera de los demas.
   * El candado evita que dos instancias de Cloud Run hagan lo mismo a la vez.
   */
  const refrescar = () => conCandado(
    `resumen:${organizationId}`,
    async () => {
      const frescos = await calcular(organizationId, new Date());
      await guardar(organizationId, frescos, new Date());
      return { problemas: frescos.problemas.length };
    },
    { organizationId, minutos: 5 },
  ).catch(() => undefined);

  try {
    // `after` solo existe dentro de una peticion. En un script o una prueba no
    // hay a quien contestarle primero, asi que ahi se recalcula de una vez: mas
    // lento, pero devuelve lo fresco en vez de quedarse con lo viejo para
    // siempre.
    after(refrescar);
    return { datos, calculadoEl: guardado.calculadoEl };
  } catch {
    await refrescar();
    const reciente = await prisma.resumenInicio.findUnique({ where: { organizationId } });
    return reciente
      ? { datos: leer(reciente.datos), calculadoEl: reciente.calculadoEl }
      : { datos, calculadoEl: guardado.calculadoEl };
  }
}

function leer(json: string): DatosDeResumen {
  try {
    return { ...VACIO, ...(JSON.parse(json) as DatosDeResumen) };
  } catch {
    // Un resumen ilegible no puede tumbar el inicio: se enseña vacio y la
    // siguiente corrida lo reemplaza.
    return VACIO;
  }
}

/** Lo tira para que el siguiente que entre lo calcule. Lo usa el boton «actualizar». */
export async function olvidarResumen(organizationId: string) {
  await prisma.resumenInicio.deleteMany({ where: { organizationId } });
}
