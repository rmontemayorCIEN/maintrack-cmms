"use client";

/**
 * Que el sistema hable: pedir el audio y sonarlo.
 *
 * Esto vivia entero dentro del modo voz del chat. Al llegar el microfono de la
 * barra de arriba habria sido la segunda copia de las mismas tres funciones
 * —pedir una frase fija, pedir la voz de una respuesta, y sonarla sin quedarse
 * colgado—, y cada copia habria aprendido por su cuenta las trampas que la
 * otra ya sabia. La de sonar en concreto tiene una que costo encontrar, abajo.
 *
 * Lo que decide QUE se dice se queda en cada pantalla; aqui solo esta el como.
 */

/** Las frases fijas que el servidor tiene sintetizadas. */
export type ClaveFrase = "saludo" | "pensando" | "sinDatos" | "tope";

/**
 * Suena un audio y AVISA cuando termino, pase lo que pase.
 *
 * Aqui estaba el defecto que dejaba la pantalla en «Contestando…» para
 * siempre: si el navegador bloquea la reproduccion —y lo hace, porque entre la
 * pregunta y la respuesta pasan diez segundos y el permiso del clic ya
 * caduco— nadie volvia a poner el estado en reposo. La promesa se cierra sola
 * en los cuatro casos: termino, fallo, lo bloquearon, o se paso de largo el
 * tiempo que podia durar.
 *
 * Devuelve si de verdad se oyo, para poder decirlo cuando no.
 */
export function reproducir(blob: Blob, pista: HTMLAudioElement): Promise<boolean> {
  return new Promise((listo) => {
    let cerrado = false;
    const cerrar = (ok: boolean) => { if (!cerrado) { cerrado = true; clearTimeout(reloj); listo(ok); } };
    // Red de seguridad: ningun audio del sistema dura mas de dos minutos.
    const reloj = setTimeout(() => cerrar(false), 120_000);

    pista.onended = () => cerrar(true);
    pista.onerror = () => cerrar(false);
    pista.src = URL.createObjectURL(blob);
    pista.play().catch(() => cerrar(false));
  });
}

/**
 * El audio de una frase fija del sistema.
 *
 * `null` cuando no hay voz —sin credenciales, sin complemento, o fallo la
 * sintesis—. No es un error que haya que gritar: se sigue pudiendo leer.
 */
export async function pedirFrase(clave: ClaveFrase): Promise<Blob | null> {
  try {
    const r = await fetch("/api/ia/voz/frase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave }),
    });
    if (r.status === 204 || !r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

/**
 * El audio de un texto que ya se genero.
 *
 * Manda el texto tal cual: la ruta se encarga de leerlo como se dice —los
 * importes con su «mil pesos» y no cifra por cifra— y de acotar el largo.
 */
export async function pedirVoz(texto: string): Promise<Blob | null> {
  try {
    const r = await fetch("/api/ia/consulta/voz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    if (r.status === 204 || !r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}
