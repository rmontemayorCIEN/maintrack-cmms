/**
 * Genera los iconos de la aplicacion instalable.
 *
 * Sin estos archivos el telefono no puede instalar MainTrack en la pantalla de
 * inicio, y sin instalarlo en iPhone NO llegan los avisos. Por eso los iconos
 * no son adorno: son requisito de la funcionalidad.
 *
 * Se dibujan por codigo, sin tipografia: una fuente que el servidor no tenga
 * instalada se sustituye en silencio y el icono sale con otra letra. La "M" es
 * un trazo, asi que se ve igual en cualquier maquina.
 *
 * Se corre a mano cuando cambie la marca, no en cada compilacion:
 *   npx tsx scripts/generar-iconos.ts
 *
 * Para reemplazarlos por el logotipo real, cambie SOLO este archivo y vuelva a
 * correrlo. Asi los tamanos y el area segura siguen saliendo bien.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const AZUL = "#1f3eee";
const PUBLICO = join(process.cwd(), "public");

/**
 * La "M" como trazo, centrada en una caja de 0..100.
 *
 * `escala` encoge el dibujo hacia el centro. Android recorta el icono con la
 * forma que quiera —circulo, gota, cuadrado— y solo garantiza el 80% central:
 * el logotipo va dentro de esa zona o le cortan las puntas.
 */
function marca(escala: number, color = "#ffffff") {
  const c = (v: number) => (50 + (v - 50) * escala).toFixed(2);
  const puntos = [
    [27, 73],
    [27, 29],
    [50, 57],
    [73, 29],
    [73, 73],
  ] as const;
  const d = puntos.map(([x, y], i) => `${i === 0 ? "M" : "L"}${c(x)},${c(y)}`).join(" ");
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${(13 * escala).toFixed(2)}"
    stroke-linecap="round" stroke-linejoin="round" />`;
}

/** Icono normal: cuadrado con esquinas redondeadas, como lo pinta la mayoria. */
function svgRedondeado() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="${AZUL}" />
    ${marca(1)}
  </svg>`;
}

/**
 * Icono "maskable": el fondo llega hasta la orilla y el dibujo se encoge.
 *
 * Si se entrega el redondeado y el sistema lo recorta en circulo, quedan
 * cuatro esquinas transparentes con un borde raro. Este va a sangre.
 */
function svgMaskable() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="${AZUL}" />
    ${marca(0.72)}
  </svg>`;
}

/** iOS ignora la transparencia y pone fondo negro: va siempre relleno. */
function svgApple() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="${AZUL}" />
    ${marca(0.82)}
  </svg>`;
}

/**
 * La insignia de la barra de estado en Android: silueta blanca, sin fondo.
 * El sistema la pinta de un solo color, asi que el azul se perderia.
 */
function svgInsignia() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    ${marca(0.92)}
  </svg>`;
}

async function png(svg: string, lado: number, nombre: string) {
  const buffer = await sharp(Buffer.from(svg)).resize(lado, lado).png().toBuffer();
  await writeFile(join(PUBLICO, nombre), buffer);
  console.log(`  ${nombre.padEnd(28)} ${lado}×${lado}  ${(buffer.length / 1024).toFixed(1)} KB`);
}

async function main() {
  await mkdir(PUBLICO, { recursive: true });
  console.log("\nGenerando iconos en public/\n");

  await png(svgRedondeado(), 192, "icono-192.png");
  await png(svgRedondeado(), 512, "icono-512.png");
  await png(svgMaskable(), 512, "icono-maskable-512.png");
  await png(svgApple(), 180, "apple-touch-icon.png");
  await png(svgInsignia(), 96, "insignia-96.png");

  // El favicon de la pestana. Se deja en PNG y no en .ico: todos los
  // navegadores vigentes lo aceptan y evita un formato mas que mantener.
  await png(svgRedondeado(), 32, "favicon.png");

  console.log("\nListo.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
