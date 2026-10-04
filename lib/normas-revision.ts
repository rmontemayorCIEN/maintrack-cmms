/**
 * Las revisiones del catálogo normativo, como funciones puras.
 *
 * Viven aquí y no dentro del script para que la prueba ejercite EXACTAMENTE lo
 * mismo que corre en el despliegue. Una prueba que replicara estas reglas por
 * su cuenta podría pasar mientras el despliegue deja entrar un catálogo roto:
 * es el defecto más caro que ha tenido este proyecto.
 *
 * Lo que se revisa aquí va más allá del esquema de Zod. El esquema mira la
 * FORMA de un paquete; esto mira el paquete completo y su historia: claves que
 * desaparecen, versiones que no subieron, giros inventados. Son las cosas que
 * no rompen nada al cargar y hacen daño callado.
 */
import { esquemaPaquete } from "./normas-catalogo";
import { ORDEN_TIPOS_OBLIGACION } from "./normas-tipos";
import { INSTALACIONES } from "./instalaciones";

export type Hallazgo = { grave: boolean; texto: string };

/** La forma del paquete, con el mismo esquema que se usa al cargarlo. */
export function problemasDeForma(paquete: unknown): Hallazgo[] {
  const r = esquemaPaquete.safeParse(paquete);
  if (r.success) return [];
  return r.error.issues.map((i) => ({
    grave: true,
    texto: `${i.path.join(".") || "(raíz)"}: ${i.message}`,
  }));
}

type PaqueteMinimo = {
  version: number;
  normas: Array<{
    clave: string;
    version: number;
    giros: string[];
    obligaciones: Array<{ clave: string; tipo: string; cadaDias?: number }>;
  }>;
};

/** Lo que solo se ve mirando el paquete completo. */
export function problemasDeCoherencia(p: PaqueteMinimo): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  const claves = p.normas.map((n) => n.clave);
  const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
  if (repetidas.length) hallazgos.push({ grave: true, texto: `claves de norma repetidas: ${[...new Set(repetidas)].join(", ")}` });

  for (const n of p.normas) {
    const suyas = n.obligaciones.map((o) => o.clave);
    const rep = suyas.filter((c, i) => suyas.indexOf(c) !== i);
    if (rep.length) hallazgos.push({ grave: true, texto: `${n.clave}: claves de obligación repetidas: ${[...new Set(rep)].join(", ")}` });

    const inventados = n.giros.filter((g) => !(g in INSTALACIONES));
    if (inventados.length) hallazgos.push({ grave: true, texto: `${n.clave}: giros que no existen — ${inventados.join(", ")}` });

    for (const o of n.obligaciones) {
      if (!ORDEN_TIPOS_OBLIGACION.includes(o.tipo as never)) {
        hallazgos.push({ grave: true, texto: `${n.clave}/${o.clave}: tipo desconocido «${o.tipo}»` });
      }
      /*
       * Una actividad sin periodo no se puede medir: en cuanto se le amarre
       * algo queda «al corriente» para siempre. No es grave —hay obligaciones
       * que de verdad no son periódicas— pero sí conviene mirarlo.
       */
      if (o.tipo === "ACTIVIDAD" && !o.cadaDias) {
        hallazgos.push({ grave: false, texto: `${n.clave}/${o.clave}: actividad sin periodo, no se puede medir si se atrasó` });
      }
    }
  }
  return hallazgos;
}

/**
 * Lo que cambió contra la versión anterior.
 *
 * Dos reglas, y las dos existen porque romperlas hace daño callado:
 *
 * - **Una clave no desaparece nunca.** Es con lo que cada cliente tiene
 *   amarrado su trabajo; si se va, su amarre queda huérfano y su obligación
 *   vuelve a «sin respaldo» sin que nadie le explique por qué.
 * - **Si el contenido cambia, la versión sube.** De eso depende el aviso de
 *   «esto cambió desde que usted lo adoptó», que es todo el mecanismo de
 *   monitoreo de cambios que tenemos hoy.
 */
export function problemasContraAnterior(antes: PaqueteMinimo, ahora: PaqueteMinimo): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  const idas = antes.normas.filter((a) => !ahora.normas.some((b) => b.clave === a.clave));
  if (idas.length) {
    hallazgos.push({
      grave: true,
      texto: `desaparecieron normas que antes existían: ${idas.map((n) => n.clave).join(", ")}. Si una se sustituye, se agrega la nueva y se deja la vieja.`,
    });
  }

  for (const a of antes.normas) {
    const b = ahora.normas.find((x) => x.clave === a.clave);
    if (!b) continue;

    const obligacionesIdas = a.obligaciones.filter((o) => !b.obligaciones.some((x) => x.clave === o.clave));
    if (obligacionesIdas.length) {
      hallazgos.push({
        grave: true,
        texto: `${a.clave}: desaparecieron obligaciones (${obligacionesIdas.map((o) => o.clave).join(", ")}); eso deja huérfano lo que el cliente ya amarró`,
      });
    }

    const sinVersion = (n: unknown) => JSON.stringify({ ...(n as Record<string, unknown>), version: 0 });
    if (sinVersion(a) !== sinVersion(b) && b.version === a.version) {
      hallazgos.push({
        grave: true,
        texto: `${a.clave}: cambió su contenido pero no subió su «version» (sigue en ${a.version}); sin eso nadie se entera del cambio`,
      });
    }
  }

  if (JSON.stringify(antes.normas) !== JSON.stringify(ahora.normas) && ahora.version === antes.version) {
    hallazgos.push({
      grave: true,
      texto: `el contenido cambió pero no subió la «version» del paquete (sigue en ${antes.version})`,
    });
  }

  return hallazgos;
}
