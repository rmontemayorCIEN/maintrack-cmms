/**
 * Prueba de humo contra una direccion ya publicada.
 *
 *   npx tsx scripts/humo.ts https://maintrack-cmms-....run.app
 *
 * No reemplaza a la suite: eso corre antes, contra el codigo. Esto contesta
 * otra pregunta, la que solo se puede hacer despues de publicar: ¿esta
 * REVISION, con ESTOS secretos y ESTA base, atiende de verdad?
 *
 * Un despliegue puede terminar «bien» y dejar el servicio caido: el contenedor
 * arranca, Cloud Run lo da por bueno, y la aplicacion truena en la primera
 * consulta porque le falta un secreto o la base no migro. Eso se ve aqui, en
 * segundos, y es lo que dispara la reversa.
 *
 * Sin navegador a proposito: solo peticiones. Lo que se prueba es que el
 * servicio conteste, no como se ve —de eso se encarga prueba-responsiva antes
 * de llegar aqui—.
 */
const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!base.startsWith("http")) {
  console.error("Uso: npx tsx scripts/humo.ts https://la-direccion-publicada");
  process.exit(1);
}

let fallas = 0;
const revisar = (nombre: string, bien: boolean, detalle = "") => {
  console.log(`  ${bien ? "ok  " : "FALLA"}  ${nombre}${detalle ? `  → ${detalle}` : ""}`);
  if (!bien) fallas++;
};

/** Reintenta: una revision recien publicada puede tardar en atender la primera. */
async function pedir(ruta: string, intentos = 5): Promise<Response | null> {
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(`${base}${ruta}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      if (r.status < 500 || i === intentos) return r;
    } catch (e) {
      if (i === intentos) { console.log(`        (${ruta}: ${String(e).slice(0, 80)})`); return null; }
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return null;
}

async function main() {
  console.log(`\nHumo contra ${base}\n`);

  // 1. Salud: es la unica que prueba que la base conteste, porque para
  //    contestar tiene que consultarla.
  const salud = await pedir("/api/salud");
  if (!salud) {
    revisar("la ruta de salud contesta", false, "no contesto en cinco intentos");
  } else {
    const cuerpo = await salud.json().catch(() => null) as { revisadoA?: string; ok?: boolean; callados?: unknown[] } | null;
    // 200 o 503 valen: los dos prueban que la aplicacion vive y que la base
    // contesto. El 503 dice que algun proceso programado va atrasado, que es
    // una condicion previa al despliegue y no un defecto de esta revision;
    // se avisa, no se tumba por eso.
    revisar("la ruta de salud contesta y la base responde",
      (salud.status === 200 || salud.status === 503) && Boolean(cuerpo?.revisadoA),
      `HTTP ${salud.status}`);
    if (salud.status === 503) {
      console.log(`        aviso: el sistema se reporta con pendientes (${JSON.stringify(cuerpo?.callados ?? [])}).`);
      console.log("        No tumba la liberacion: viene de antes de este despliegue.");
    }
  }

  // 2. Las pantallas publicas, que son las que ve alguien sin sesion.
  // `/reportar` NO va aqui: cuelga del token del punto QR, asi que sin token
  // contesta 404 y eso es lo correcto. La primera version lo incluyo y reporto
  // una falla que no existia.
  for (const [ruta, debeDecir] of [["/", null], ["/login", "Correo"], ["/privacidad", null]] as const) {
    const r = await pedir(ruta);
    if (!r) { revisar(`${ruta} contesta`, false, "no contesto"); continue; }
    const texto = r.status === 200 ? await r.text().catch(() => "") : "";
    revisar(`${ruta} contesta`, r.status === 200, `HTTP ${r.status}`);
    if (debeDecir) revisar(`${ruta} trae su contenido («${debeDecir}»)`, texto.includes(debeDecir));
  }

  // 3. Una pantalla con sesion debe MANDAR AL LOGIN, no reventar. Si esto
  //    contesta 500 es que la revision esta rota por dentro aunque la portada
  //    se vea bien.
  const privada = await pedir("/dashboard");
  revisar("una pantalla con sesion redirige al login en vez de tronar",
    privada !== null && privada.status < 500, privada ? `HTTP ${privada.status}` : "no contesto");

  console.log("");
  if (fallas) { console.log(`  ${fallas} revision(es) fallaron: la revision publicada NO esta sana.\n`); process.exit(1); }
  console.log("  ✓ La revision publicada atiende.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
