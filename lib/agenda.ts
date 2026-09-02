/**
 * La agenda: dias habiles, capacidad y carga real del calendario.
 *
 * Todo lo de aqui es aritmetica, a proposito. Cuando haya una funcion de IA
 * que revise la semana, recibira estos numeros ya resueltos y solo los
 * interpretara. Un modelo sumando horas por tecnico es un error silencioso
 * esperando fecha.
 */
import { prisma } from "./db";

/** Lunes es 1 y domingo es 7, como en la norma ISO y como habla la gente. */
export const diaSemanaIso = (d: Date) => ((d.getDay() + 6) % 7) + 1;

export const mismaFecha = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** El n-esimo lunes de un mes: asi define la ley varios festivos mexicanos. */
function lunesNumero(anio: number, mes: number, n: number): Date {
  const primero = new Date(anio, mes, 1);
  const desplazamiento = (8 - primero.getDay()) % 7; // dias hasta el primer lunes
  return new Date(anio, mes, 1 + desplazamiento + (n - 1) * 7);
}

/**
 * Festivos de ley en Mexico para un anio (articulo 74 de la Ley Federal del
 * Trabajo). Se precargan, pero la empresa puede agregar y quitar: cada quien
 * cierra en dias propios.
 */
export function festivosDeLey(anio: number): { fecha: Date; nombre: string }[] {
  const dias = [
    { fecha: new Date(anio, 0, 1), nombre: "Ano nuevo" },
    { fecha: lunesNumero(anio, 1, 1), nombre: "Dia de la Constitucion" },
    { fecha: lunesNumero(anio, 2, 3), nombre: "Natalicio de Benito Juarez" },
    { fecha: new Date(anio, 4, 1), nombre: "Dia del Trabajo" },
    { fecha: new Date(anio, 8, 16), nombre: "Independencia de Mexico" },
    { fecha: lunesNumero(anio, 10, 3), nombre: "Revolucion Mexicana" },
    { fecha: new Date(anio, 11, 25), nombre: "Navidad" },
  ];
  // Cada seis anios, la transmision del Poder Ejecutivo Federal.
  if ((anio - 2024) % 6 === 0) {
    dias.push({ fecha: new Date(anio, 9, 1), nombre: "Transmision del Poder Ejecutivo" });
  }
  return dias.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}

export type Jornada = {
  horasJornada: number;
  diasHabiles: number[];
  festivos: { fecha: Date; nombre: string }[];
};

/** La configuracion de jornada de una organizacion, ya resuelta. */
export async function jornada(organizationId: string, desde: Date, hasta: Date): Promise<Jornada> {
  const [org, festivos] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { horasJornada: true, diasHabiles: true },
    }),
    prisma.diaFestivo.findMany({
      where: { organizationId, fecha: { gte: desde, lte: hasta } },
      select: { fecha: true, nombre: true },
    }),
  ]);
  return {
    horasJornada: org?.horasJornada ?? 8,
    diasHabiles: (org?.diasHabiles ?? "1,2,3,4,5")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => d >= 1 && d <= 7),
    festivos,
  };
}

export function esHabil(fecha: Date, j: Jornada): boolean {
  if (!j.diasHabiles.includes(diaSemanaIso(fecha))) return false;
  return !j.festivos.some((f) => mismaFecha(f.fecha, fecha));
}

export function festivoDe(fecha: Date, j: Jornada): string | null {
  return j.festivos.find((f) => mismaFecha(f.fecha, fecha))?.nombre ?? null;
}

export type CargaPersona = {
  userId: string | null;
  nombre: string;
  color: string | null;
  horas: number;
  capacidad: number;
  ordenes: number;
  /** Mas de 1 significa que ese dia no cabe lo asignado. */
  ocupacion: number;
};

export type CargaDia = {
  fecha: Date;
  habil: boolean;
  festivo: string | null;
  horas: number;
  capacidad: number;
  personas: CargaPersona[];
  sobrecargado: boolean;
};

type OrdenParaCarga = {
  dueDate: Date | null;
  estimatedHours: number;
  status: string;
  assignedTo: { id: string; name: string; color: string | null; horasDisponibles: number | null } | null;
};

/**
 * Carga por dia y por persona en un rango.
 *
 * La capacidad de cada quien es su propio valor si lo tiene, y si no la
 * jornada de la organizacion: se define por excepcion, no llenando un campo
 * por empleado. En dia no habil la capacidad es cero, asi que cualquier
 * trabajo programado ahi sale marcado.
 */
export function cargaPorDia(
  fechas: Date[],
  ordenes: OrdenParaCarga[],
  j: Jornada,
  cerradas: string[] = ["COMPLETED", "CLOSED", "CANCELLED"],
): CargaDia[] {
  const abiertas = ordenes.filter((o) => !cerradas.includes(o.status));

  return fechas.map((fecha) => {
    const habil = esHabil(fecha, j);
    const delDia = abiertas.filter((o) => o.dueDate && mismaFecha(o.dueDate, fecha));

    const porPersona = new Map<string, CargaPersona>();
    for (const o of delDia) {
      const clave = o.assignedTo?.id ?? "__sin_asignar";
      const previo = porPersona.get(clave);
      const capacidad = habil ? (o.assignedTo?.horasDisponibles ?? j.horasJornada) : 0;
      if (previo) {
        previo.horas += o.estimatedHours;
        previo.ordenes += 1;
        previo.ocupacion = previo.capacidad > 0 ? previo.horas / previo.capacidad : Infinity;
      } else {
        const horas = o.estimatedHours;
        porPersona.set(clave, {
          userId: o.assignedTo?.id ?? null,
          nombre: o.assignedTo?.name ?? "Sin responsable",
          color: o.assignedTo?.color ?? null,
          horas,
          capacidad,
          ordenes: 1,
          ocupacion: capacidad > 0 ? horas / capacidad : Infinity,
        });
      }
    }

    const personas = [...porPersona.values()].sort((a, b) => b.horas - a.horas);
    const horas = personas.reduce((s, p) => s + p.horas, 0);
    // La capacidad del dia es la de quienes tienen trabajo asignado ese dia.
    // Sumar la de toda la plantilla diria que hay holgura donde no la hay: el
    // problema no es que falte gente, es que a una persona no le cabe.
    const capacidad = personas.reduce((s, p) => s + p.capacidad, 0);

    return {
      fecha,
      habil,
      festivo: festivoDe(fecha, j),
      horas,
      capacidad,
      personas,
      sobrecargado: personas.some((p) => p.ocupacion > 1),
    };
  });
}
