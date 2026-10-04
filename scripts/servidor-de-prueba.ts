/**
 * El servidor de una prueba: levantarlo y apagarlo.
 *
 * Trece pruebas levantan su propio `next dev`. Todas lo apagaban igual: un
 * SIGTERM al grupo y a otra cosa, sin esperar. Aqui se espera a que el proceso
 * se haya ido de verdad antes de devolver el control, y con el puerto se barre
 * lo que hubiera quedado escuchando —que es lo que ya hacia
 * `prueba-responsiva` desde que un servidor zombi costo medio dia—.
 *
 * ── Lo que el apagado NO arregla, para que nadie lo suponga ──
 *
 * Se escribio persiguiendo el 500 esporadico de la suite, sospechando que dos
 * `next dev` coincidieran sobre el mismo `.next`. Se midio y NO era eso: el
 * maximo de puertos en escucha simultaneos es UNO, nunca coinciden. Tampoco
 * era la causa real, que resulto ser el vigilante de archivos recompilando al
 * ver cambiar la base de datos (ver `next.config.ts`).
 *
 * Esto se queda porque esperar a que un proceso muera antes de seguir es
 * correcto y ya hubo zombis antes, no porque curara aquello.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Donde queda lo que el servidor escribio.
 *
 * ── Por que esto existe ──
 *
 * Las dieciseis pruebas que levantan servidor lo hacian con `stdio: "ignore"`,
 * o sea tirando a la basura todo lo que el servidor decia. Y con eso apagado
 * se persiguio durante meses un 500 esporadico que tumbaba una prueba al azar
 * dentro de la suite: se miraba el numero de status desde el lado del cliente
 * sin haber leido NUNCA la excepcion que lo producia, porque se estaba
 * tirando.
 *
 * En cuanto se guardo, aparecio en la primera cacería: «SyntaxError:
 * Unexpected end of JSON input». La causa esta explicada en `next.config.ts`
 * —el vigilante de archivos veia cambiar `prisma/dev.db` y recompilaba— y ahi
 * quedo arreglada. Esto se queda: la proxima vez que algo falle solo dentro
 * de la suite, el log ya esta.
 *
 * Aqui se guarda. Un archivo por prueba y puerto, en la carpeta temporal del
 * sistema: no ensucia el repositorio y sobrevive a que la prueba termine, que
 * es justo cuando hace falta leerlo.
 */
const CARPETA = join(tmpdir(), "maintrack-servidores");

/** Donde quedo el log de este servidor. */
export function rutaDelLog(puerto: number, nombre?: string): string {
  const quien = nombre ?? basename(process.argv[1] ?? "prueba", ".ts");
  return join(CARPETA, `${quien}-${puerto}.log`);
}

/**
 * Levanta el servidor de una prueba, guardando lo que escriba.
 *
 * `modo` es "dev" para casi todas y "start" para la responsiva, que mide la
 * aplicacion compilada y por eso necesita el build —y de paso es la razon de
 * que la suite le borre el BUILD_ID—.
 */
export function levantarServidor(opciones: {
  puerto: number;
  modo?: "dev" | "start";
  /** Variables extra. Se agregan a las del proceso, no las reemplazan. */
  env?: Record<string, string>;
  /** Con que nombre guardar el log. Por omision, el de la prueba que llama. */
  nombre?: string;
}): ChildProcess {
  const { puerto, modo = "dev", env, nombre } = opciones;
  mkdirSync(CARPETA, { recursive: true });
  const fd = openSync(rutaDelLog(puerto, nombre), "w");
  const hijo = spawn("npx", ["next", modo, "-p", String(puerto), "-H", "127.0.0.1"], {
    // El hijo se queda con el descriptor para su salida y sus errores; la
    // entrada no se usa. Se cierra del lado del padre en cuanto lo hereda, o
    // quedaria un descriptor abierto por cada prueba de la suite.
    stdio: ["ignore", fd, fd],
    detached: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  closeSync(fd);
  return hijo;
}

/**
 * El final del log del servidor, para imprimirlo cuando una prueba falla.
 *
 * Que una prueba diga «esperaba 4xx y llego 500» no sirve de nada sin esto:
 * el 500 es la pagina tronando, y la razon esta aqui.
 */
export function colaDelLog(puerto: number, lineas = 40, nombre?: string): string {
  try {
    const todo = readFileSync(rutaDelLog(puerto, nombre), "utf8").trimEnd().split("\n");
    return todo.slice(-lineas).join("\n");
  } catch {
    return "(no se pudo leer el log del servidor)";
  }
}

/** Cuanto se espera, como maximo, a que el servidor se vaya por las buenas. */
const ESPERA_MAX_MS = 4000;

/** Si el grupo de procesos sigue vivo. La señal 0 no mata: solo pregunta. */
function sigueVivo(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function apagarServidor(servidor: ChildProcess | null | undefined, puerto?: number): Promise<void> {
  const pid = servidor?.pid;
  if (pid) {
    try { process.kill(-pid, "SIGTERM"); } catch { /* ya habia terminado */ }

    const hasta = Date.now() + ESPERA_MAX_MS;
    while (Date.now() < hasta && sigueVivo(pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // No se fue por las buenas: se va por las malas. Dejarlo vivo es peor que
    // matarlo, porque el que paga el enredo es quien corra la prueba siguiente.
    if (sigueVivo(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* se fue entre una linea y otra */ }
    }
  }

  // Y lo que siga escuchando en el puerto, venga de donde venga.
  if (puerto) {
    try { execSync(`lsof -ti:${puerto} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* nada escuchando */ }
  }
}
