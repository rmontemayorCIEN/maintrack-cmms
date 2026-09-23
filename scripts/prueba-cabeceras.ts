/**
 * Las cabeceras de seguridad: que esten, y que no apaguen lo que se usa.
 *
 * ── Por que existe ──
 *
 * `Permissions-Policy` decia `microphone=()`, o sea que la aplicacion se pedia
 * a si misma no poder grabar. Era cierto cuando se escribio —no habia voz— y
 * dejo de serlo el dia que se construyo el chat de voz. Nadie volvio a mirarlo
 * porque ninguna prueba miraba las cabeceras.
 *
 * Y el sintoma engañaba: Safari de iPhone no aplica esa politica al microfono,
 * asi que dictar funcionaba en el telefono y fallaba en la laptop con un «no
 * se pudo usar el microfono» que parecia un permiso del sistema operativo. Se
 * perdieron tres funciones —chat de voz, dictado y comandos de voz— sin un
 * solo error en los registros.
 *
 * ── Las dos preguntas ──
 *
 * Una cabecera de seguridad no solo tiene que ESTAR: tiene que no estorbar lo
 * que la aplicacion hace. Aqui se revisan las dos cosas, porque apagar de mas
 * es tan defecto como no proteger.
 *
 *   npx tsx scripts/prueba-cabeceras.ts
 */
import { type ChildProcess } from "node:child_process";
import { apagarServidor, levantarServidor } from "./servidor-de-prueba";

const PUERTO = 3220;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function esperarServidor(limiteMs = 120_000) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) return;
    } catch { /* todavia no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) servidor = levantarServidor({ puerto: PUERTO });

  try {
    await esperarServidor();
    const r = await fetch(`${base}/login`);
    const h = (n: string) => r.headers.get(n) ?? "";

    console.log("\nLo que un escaneo de seguridad busca\n");
    revisar("la conexión se exige por TLS también después", h("strict-transport-security").includes("max-age="), h("strict-transport-security"));
    revisar("no se adivina el tipo de contenido", h("x-content-type-options") === "nosniff");
    revisar("nadie puede incrustar la aplicación", h("x-frame-options") === "DENY", h("x-frame-options"));
    revisar("   y también por política de contenido", h("content-security-policy").includes("frame-ancestors 'none'"));
    revisar("no se filtra la ruta interna al salir", h("referrer-policy").length > 0, h("referrer-policy"));
    revisar("no se anuncia con qué está hecho", !h("x-powered-by"), h("x-powered-by") || "(sin anunciar)");

    console.log("\nY que no apaguen lo que la aplicación sí usa\n");
    const politica = h("permissions-policy");
    revisar("hay política de permisos", politica.length > 0, politica);

    /**
     * El microfono se usa en tres lugares —chat de voz, dictado del tecnico y
     * comandos de voz—, asi que NO puede estar apagado.
     *
     * `microphone=()` es la lista vacia: nadie, ni la propia aplicacion. Es lo
     * que estuvo puesto y lo que rompio las tres sin que se notara.
     */
    revisar("el micrófono NO está apagado: la aplicación graba",
      !/microphone=\(\s*\)/.test(politica), politica);
    revisar("   y está permitido al propio origen",
      /microphone=\(self\)/.test(politica), politica);
    // Y lo que de verdad no se usa, sigue apagado.
    revisar("la ubicación sigue apagada, que no se usa", /geolocation=\(\s*\)/.test(politica));
    revisar("los pagos y el usb también", /payment=\(\s*\)/.test(politica) && /usb=\(\s*\)/.test(politica));
    // La camara la usa el escaner de QR: no listarla la deja en «solo el
    // propio origen», que es lo correcto. Listarla vacia la apagaria.
    revisar("la cámara no está apagada: de ella vive el escáner de QR",
      !/camera=\(\s*\)/.test(politica), politica);
  } finally {
    await apagarServidor(servidor, PUERTO);
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(() => process.exit(fallas ? 1 : 0));
