/**
 * Apagar el servidor de una prueba, y ESPERAR a que muera.
 *
 * Trece pruebas levantan su propio `next dev`. Todas lo apagaban igual: un
 * SIGTERM al grupo y a otra cosa, sin esperar. Aqui se espera a que el proceso
 * se haya ido de verdad antes de devolver el control, y con el puerto se barre
 * lo que hubiera quedado escuchando —que es lo que ya hacia
 * `prueba-responsiva` desde que un servidor zombi costo medio dia—.
 *
 * ── Lo que esto NO arregla, para que nadie lo suponga ──
 *
 * Se escribio persiguiendo las fallas intermitentes de `prueba-permisos` y
 * `prueba-experiencia`: las dos caen dentro de la suite completa, pasan
 * siempre corriendo solas, y las dos lo hacen con un 500 que la prueba reporta
 * como si fuera lo que estuviera revisando. La sospecha era que dos `next dev`
 * coincidieran sobre el mismo `.next`, que es la trampa que advierte el
 * CLAUDE.md.
 *
 * Se midio, y NO es eso: vigilando los puertos en escucha durante la suite, el
 * maximo simultaneo es UNO. Nunca coinciden. La causa de esas intermitencias
 * sigue sin encontrarse.
 *
 * Esto se queda porque esperar a que un proceso muera antes de seguir es
 * correcto y ya hubo zombis antes, no porque cure aquello.
 */
import { execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

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
