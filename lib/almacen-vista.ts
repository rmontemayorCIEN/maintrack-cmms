/**
 * La franja del almacen: como esta el inventario, de un vistazo.
 *
 * Hermana de `lib/planta.ts`. Alli cada cuadro es un equipo; aqui cada cuadro
 * es una refaccion, y el color dice si hay de menos, de mas, o si nadie ha
 * dicho cuanto deberia haber.
 *
 * ── Por que se agrupa asi ──
 *
 * Por familia cuando las hay, porque es como piensa un almacenista: «los
 * rodamientos estan sufriendo». Si nadie captura familias se agrupa por
 * almacen, y si ademas solo hay un almacen queda un solo renglon con todo.
 * Ese ultimo caso no es un error ni una franja rota: es un almacen sin
 * clasificar, y se dice con esas palabras en vez de enseñar una barra sola y
 * muda.
 *
 * Es el mismo escalon que usa la franja de planta con sistemas y areas.
 *
 * ── Los numeros los suma TypeScript ──
 *
 * Nada de esto se le pregunta al modelo, y el estado de cada refaccion sale de
 * `lib/almacen-estado.ts`, que es el mismo que usa el analisis del almacen.
 * Dos pantallas que responden «cuantas estan bajo minimo» tienen que dar el
 * mismo numero.
 */
import { prisma } from "./db";
import { repartirEnCuadros, SEGMENTOS } from "./barra";
import {
  estadoDeRefaccion,
  ORDEN_ESTADO,
  type EstadoRefaccion,
} from "./almacen-estado";

export { SEGMENTOS };

/** Cuantos renglones se dibujan, como maximo. */
export const MAX_FILAS = 8;

export type FilaDeAlmacen = {
  id: string;
  nombre: string;
  enlace: string;
  refacciones: number;
  agotadas: number;
  bajoMinimo: number;
  sinControl: number;
  excedidas: number;
  sanas: number;
  /** Lo que vale lo que hay, para saber donde esta parado el dinero. */
  valor: number;
  /** «3 agotadas · 2 bajo mínimo», o «todo en nivel». */
  comoEstan: string;
};

export type FranjaDeAlmacen = {
  filas: FilaDeAlmacen[];
  /** Por que se agrupo asi, para decirlo en pantalla. */
  agrupadoPor: "familia" | "almacen" | "todo";
  refacciones: number;
  /** Las que no caben en MAX_FILAS, resumidas. */
  otras: number;
  valorTotal: number;
  /** Cuantas no tienen minimo: lo que hay que capturar para que esto sirva. */
  sinControl: number;
};

const dinero = (n: number) => Math.round(n * 100) / 100;

/** «2 agotadas · 1 bajo mínimo», o «todo en nivel» cuando no hay nada que decir. */
export function comoEstanLas(f: Pick<FilaDeAlmacen, "agotadas" | "bajoMinimo" | "sinControl" | "excedidas" | "refacciones">): string {
  const partes = [
    f.agotadas ? `${f.agotadas} ${f.agotadas === 1 ? "agotada" : "agotadas"}` : null,
    f.bajoMinimo ? `${f.bajoMinimo} bajo mínimo` : null,
    f.sinControl ? `${f.sinControl} sin mínimo` : null,
    f.excedidas ? `${f.excedidas} por encima del máximo` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "todo en nivel";
}

/** Primero el renglon que mas urge atender. */
function porGravedad(a: FilaDeAlmacen, b: FilaDeAlmacen) {
  return b.agotadas - a.agotadas
    || b.bajoMinimo - a.bajoMinimo
    || b.sinControl - a.sinControl
    || b.excedidas - a.excedidas
    || a.nombre.localeCompare(b.nombre, "es");
}

export async function franjaDeAlmacen(organizationId: string): Promise<FranjaDeAlmacen | null> {
  const refacciones = await prisma.part.findMany({
    where: { organizationId, active: true },
    select: {
      id: true, category: true, quantityOnHand: true, minQuantity: true, maxQuantity: true, unitCost: true,
      existencias: { select: { warehouseId: true } },
    },
  });
  if (!refacciones.length) return null;

  const conFamilia = refacciones.some((p) => (p.category ?? "").trim());
  let agrupadoPor: FranjaDeAlmacen["agrupadoPor"] = "todo";
  let almacenes = new Map<string, string>();

  if (conFamilia) {
    agrupadoPor = "familia";
  } else {
    const lista = await prisma.warehouse.findMany({ where: { organizationId }, select: { id: true, name: true } });
    almacenes = new Map(lista.map((w) => [w.id, w.name]));
    if (almacenes.size > 1) agrupadoPor = "almacen";
  }

  const SIN_FAMILIA = "«Sin familia»";
  const base = new Map<string, FilaDeAlmacen>();
  const fila = (id: string, nombre: string, enlace: string) => {
    const previa = base.get(id);
    if (previa) return previa;
    const nueva: FilaDeAlmacen = {
      id, nombre, enlace,
      refacciones: 0, agotadas: 0, bajoMinimo: 0, sinControl: 0, excedidas: 0, sanas: 0,
      valor: 0, comoEstan: "",
    };
    base.set(id, nueva);
    return nueva;
  };

  for (const p of refacciones) {
    let clave: string;
    let nombre: string;
    let enlace: string;
    if (agrupadoPor === "familia") {
      const fam = (p.category ?? "").trim();
      clave = fam || "__sin__";
      nombre = fam || SIN_FAMILIA;
      enlace = fam ? `/inventory?categoria=${encodeURIComponent(fam)}` : "/inventory";
    } else if (agrupadoPor === "almacen") {
      // Una refaccion puede estar en varios almacenes; para la franja cuenta
      // en el primero que la tenga. Repartirla entre varios inflaria el conteo
      // y la barra diria que hay mas refacciones de las que hay.
      const w = p.existencias[0]?.warehouseId;
      clave = w ?? "__sin__";
      nombre = (w && almacenes.get(w)) || "Sin almacén";
      enlace = w ? `/inventory?almacen=${encodeURIComponent(w)}` : "/inventory";
    } else {
      clave = "todo";
      nombre = "Todo el almacén";
      enlace = "/inventory";
    }

    const f = fila(clave, nombre, enlace);
    f.refacciones++;
    f.valor += (p.quantityOnHand || 0) * (p.unitCost || 0);
    const estado = estadoDeRefaccion(p);
    if (estado === "agotada") f.agotadas++;
    else if (estado === "bajoMinimo") f.bajoMinimo++;
    else if (estado === "sinControl") f.sinControl++;
    else if (estado === "excedida") f.excedidas++;
    else f.sanas++;
  }

  const todas = [...base.values()].map((f) => ({ ...f, valor: dinero(f.valor), comoEstan: comoEstanLas(f) })).sort(porGravedad);
  const filas = todas.slice(0, MAX_FILAS);

  return {
    filas,
    agrupadoPor,
    refacciones: refacciones.length,
    otras: todas.slice(MAX_FILAS).reduce((s, f) => s + f.refacciones, 0),
    valorTotal: dinero(todas.reduce((s, f) => s + f.valor, 0)),
    sinControl: todas.reduce((s, f) => s + f.sinControl, 0),
  };
}

/** La barra de un renglon, un cuadro por refaccion mientras quepan. */
export function barraDeAlmacen(f: Pick<FilaDeAlmacen, "refacciones" | "agotadas" | "bajoMinimo" | "sinControl" | "excedidas" | "sanas">): EstadoRefaccion[] {
  return repartirEnCuadros<EstadoRefaccion>(
    [
      ["agotada", f.agotadas],
      ["bajoMinimo", f.bajoMinimo],
      ["sinControl", f.sinControl],
      ["excedida", f.excedidas],
      ["sana", f.sanas],
    ],
    f.refacciones,
    "sana",
  );
}

export { ORDEN_ESTADO };
