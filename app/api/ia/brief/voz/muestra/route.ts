import { withVista } from "@/lib/api";
import { sintetizar, vozValida, VOZ_POR_OMISION } from "@/lib/voz";

/**
 * Una muestra corta para probar una voz antes de escogerla.
 *
 * Elegir voz por su nombre —Despina, Achird, Kore— es elegir a ciegas: no le
 * dicen nada a nadie. Por eso el selector deja oír cada una.
 *
 * La frase es fija y corta a proposito: se guarda como cualquier otro audio,
 * asi que la primera persona que prueba una voz la paga —medio centavo de
 * dolar— y todas las demas de esa empresa la oyen gratis. Con el parte
 * completo, probar doce voces costaria quince centavos cada vez.
 */
const MUESTRA = "Buenos días. Trae abajo el compresor de la nave, y ese es criticidad A. Se le juntaron 12 órdenes vencidas.";

export async function GET(request: Request) {
  return withVista("/indicadores", async ({ orgId }) => {
    const pedida = new URL(request.url).searchParams.get("voz");
    const voz = vozValida(pedida) ? pedida : VOZ_POR_OMISION;

    const audio = await sintetizar(orgId, MUESTRA, voz);
    // Sin voz del servidor no hay nada que probar: la pantalla lo entiende y
    // esconde el botón en vez de dejarlo sin hacer nada.
    if (!audio) return new Response(null, { status: 204 });

    return new Response(new Uint8Array(audio.audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.audio.length),
        // La muestra no cambia nunca: vale la pena que el navegador la guarde.
        "Cache-Control": "private, max-age=86400",
      },
    });
  });
}
