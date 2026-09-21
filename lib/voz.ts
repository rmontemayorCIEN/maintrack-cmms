/**
 * La voz del sistema: convertir el parte del dia en audio.
 *
 * ── Por que una voz del servidor y no la del aparato ──
 *
 * La voz que trae el telefono es gratis y no manda nada a ningun lado, pero
 * suena a maquina, y el producto que se vende aqui es «su director se entera
 * manejando». Una voz que no se puede oir treinta segundos sin fastidiarse no
 * cumple eso. Asi que la buena se sintetiza en el servidor y la del aparato se
 * queda como respaldo: cuando no hay credenciales —desarrollo—, cuando falla
 * la sintesis, o cuando la empresa no tiene el complemento.
 *
 * ── Por que espanol de Estados Unidos y no de Mexico ──
 *
 * Porque Mexico NO existe en el catalogo: Google solo tiene es-ES y es-US. El
 * de Espana no va para un cliente mexicano, y es-US es el latino neutro, que
 * es lo mas cercano. No es una preferencia: es lo unico razonable que hay.
 *
 * ── El proyecto de Google va fijo aqui, no lo pone la maquina ──
 *
 * En esta computadora conviven MainTrack y otro sistema, y las credenciales
 * de desarrollo apuntan al OTRO. La primera sintesis local fallo con
 * «Text-to-Speech no esta habilitada en avisos-obligaciones-4821»: la
 * libreria toma el proyecto de las credenciales, no del codigo. Si la API
 * hubiera estado habilitada alla, no habria fallado —habria facturado la voz
 * de MainTrack al proyecto equivocado, en silencio—. Por eso el proyecto se
 * fija aqui, igual que `scripts/proyecto.sh` lo fija para gcloud.
 *
 * ── El costo, y por que se guarda el audio ──
 *
 * Treinta dolares por millon de caracteres. Un parte de 455 caracteres son
 * 1.4 centavos de dolar. Poco, pero el mismo parte se oye varias veces —uno se
 * distrae, lo repite— y pagar cada repeticion seria tirar dinero por nada. El
 * audio se guarda con la huella del texto: si el texto no cambio, no se vuelve
 * a sintetizar.
 */
import { createHash } from "crypto";
import { guardarArchivo, leerArchivo } from "./almacenamiento";
import { GLOSARIO } from "./glosario";

export const PROYECTO = "maintrack-cmms-4821";
export const IDIOMA = "es-US";

/**
 * Las voces que se ofrecen, de las treinta que trae es-US.
 *
 * Se curaron oyendolas con el parte real, no por su ficha: la mitad de las
 * treinta suenan igual entre si o se atoran con los codigos de equipo. Doce
 * bien distintas sirven mas que treinta donde nadie sabe cual escoger.
 *
 * La descripcion es para que alguien pueda decidir SIN oirlas todas, pero el
 * selector deja probar cada una: los nombres —Despina, Achird, Kore— no le
 * dicen nada a nadie, y elegir voz por su nombre es elegir a ciegas.
 */
export const VOCES = [
  { id: "Aoede", quien: "mujer", como: "cálida, conversacional" },
  { id: "Despina", quien: "mujer", como: "suave, tono bajo" },
  { id: "Kore", quien: "mujer", como: "firme, de reporte" },
  { id: "Leda", quien: "mujer", como: "joven, ágil" },
  { id: "Sulafat", quien: "mujer", como: "serena, con cuerpo" },
  { id: "Achernar", quien: "mujer", como: "clara y pausada" },
  { id: "Achird", quien: "hombre", como: "cercano, de confianza" },
  { id: "Algieba", quien: "hombre", como: "grave y tranquilo" },
  { id: "Charon", quien: "hombre", como: "neutro, informativo" },
  { id: "Orus", quien: "hombre", como: "seguro, con energía" },
  { id: "Puck", quien: "hombre", como: "ligero, despierto" },
  { id: "Schedar", quien: "hombre", como: "formal, de junta" },
] as const;

export type ClaveVoz = (typeof VOCES)[number]["id"];

/** La de omision, para quien no ha escogido. */
export const VOZ_POR_OMISION: ClaveVoz = "Despina";

/** El nombre completo que entiende Google. */
export function nombreDeVoz(clave: string | null | undefined): string {
  const elegida = VOCES.find((v) => v.id === clave)?.id ?? VOZ_POR_OMISION;
  return `${IDIOMA}-Chirp3-HD-${elegida}`;
}

/** Si la clave guardada sigue siendo una voz que ofrecemos. */
export function vozValida(clave: string | null | undefined): clave is ClaveVoz {
  return VOCES.some((v) => v.id === clave);
}

/** Mas lento que lo normal: son cifras, y al volante no hay repetir. */
export const RITMO = 0.95;

const TIPO = "audio/mpeg";

/** Si hay con que sintetizar. En desarrollo normalmente no, y esta bien. */
export function vozConfigurada(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCS_BUCKET || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

/**
 * El texto con sus pausas, en el formato de marcas de Chirp 3.
 *
 * Las voces Chirp 3 aceptan `[pause]`, `[pause short]` y `[pause long]`, pero
 * SOLO en el campo `markup`; en `text` se leerian como palabras. La pausa
 * larga va entre un tema y otro —terminar de hablar de lo que esta parado y
 * empezar con las ordenes vencidas— y la corta dentro de una misma idea. Sin
 * esto, el parte sale de corrido y con cifras adentro nadie retiene nada.
 *
 * Los corchetes que pudiera traer el texto se quitan antes: si un equipo se
 * llamara «Bomba [respaldo]», esa marca inventada se leeria o romperia el
 * ritmo.
 */
export function conPausas(texto: string): string {
  const limpio = texto.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
  return limpio
    // Entre oraciones, pausa larga: ahi cambia el tema.
    .replace(/([.!?])\s+/g, "$1 [pause] ")
    // Dentro de la oracion, un respiro.
    .replace(/([;:])\s+/g, "$1 [pause short] ")
    .trim();
}

/**
 * Un numero grande, como lo diria una persona.
 *
 * «128,400» leido por un sintetizador sale «ciento veintiocho coma
 * cuatrocientos». Los centavos se van: a nadie le importan al oido.
 */
function miles(n: number): string {
  if (n >= 1_000_000) {
    const millones = n / 1_000_000;
    // «de» incluido: se dice «2.5 millones DE pesos», no «millones pesos».
    return `${millones.toFixed(millones >= 10 ? 0 : 1).replace(".0", "")} millones de`;
  }
  if (n >= 1000) {
    const m = Math.floor(n / 1000);
    const resto = n % 1000;
    // El resto SE DICE. Redondear «128,400» a «128 mil» es aproximar una
    // cifra que el sistema calculo exacta, y aqui se esta contestando una
    // pregunta sobre datos: el numero es la respuesta.
    return resto ? `${m} mil ${resto}` : `${m} mil`;
  }
  return String(n);
}

/**
 * Como se dicen los folios del sistema.
 *
 * «OT-000040» leido tal cual sale «o te guion cero cero cero cero cuatro
 * cero», que no se entiende ni escrito. Se dice «la orden 40», que es como lo
 * diria cualquiera en la planta.
 *
 * Son los nueve prefijos de lib/numbering.ts y NADA mas: los codigos de
 * equipo —CMP-301, BOM-602— se dicen tal cual, porque asi se llaman y asi hay
 * que buscarlos.
 */
const FOLIOS: Record<string, string> = {
  OT: "la orden",
  SS: "la solicitud",
  TR: "el traspaso",
  RM: "la requisición",
  RC: "la compra",
  RE: "la recepción",
  OC: "la orden de compra",
  CI: "el conteo",
  SOP: "el caso de soporte",
};

/**
 * Las siglas que ya estan explicadas en el glosario.
 *
 * El glosario es el vocabulario del sistema; tener aqui una segunda lista de
 * siglas seria garantizar que un dia digan cosas distintas —alguien agrega
 * un termino alla y la voz sigue deletreandolo—. Asi que se derivan de el.
 *
 * Ojo con los dos formatos: unas veces la sigla es el termino y el nombre es
 * lo largo —«MTBF» / «Tiempo medio entre fallas»— y otras al reves —«Orden
 * de trabajo» / «OT»—. Se reconoce la sigla por como se ve: corta y en
 * mayusculas.
 */
function siglasDelGlosario(): Array<[RegExp, string]> {
  /**
   * Una sigla se reconoce por la forma: corta y casi toda en mayusculas. La
   * «d» de «PdM» y la «e» de «MTBFe» no la descalifican —asi se escriben—,
   * pero «Backlog» o «Disponibilidad» si: esas son palabras.
   */
  const esSigla = (x: string) => /^[A-Z][A-Za-z-]{1,6}$/.test(x) && x.replace(/[^A-Z]/g, "").length >= 2;
  const pares: Array<[string, string]> = [];

  for (const termino of GLOSARIO) {
    if (!termino.n) continue;
    if (esSigla(termino.t) && !esSigla(termino.n)) pares.push([termino.t, termino.n]);
    else if (esSigla(termino.n) && !esSigla(termino.t)) pares.push([termino.n, termino.t]);
  }

  // Las mas largas primero: «MTTF» no debe caer dentro de otra regla antes.
  return pares
    .sort((a, b) => b[0].length - a[0].length)
    .map(([sigla, largo]) => {
      /**
       * El articulo se corrige al sustituir.
       *
       * «el OEE» pasaba a «el eficiencia general de los equipos». Al cambiar
       * una sigla por su nombre cambia el genero, y dejar el articulo viejo
       * suena a extranjero. Se captura el articulo y se pone el que toca
       * segun como empiece el nombre largo.
       */
      /**
       * El genero se saca de la terminacion, no de una lista.
       *
       * Una lista de palabras femeninas se queda corta al primer termino que
       * alguien agregue al glosario —paso con «requisicion», que salia «el
       * requisicion»—. Las reglas del espanol cubren practicamente todo lo
       * que aparece aqui, y lo que no, suena a masculino, que es la omision
       * correcta.
       */
      const primera = largo.trim().split(/\s+/)[0].toLowerCase();
      const femenino = /(ci[oó]n|si[oó]n|dad|tad|umbre|ez|itis|a)$/.test(primera);

      return [
        new RegExp(`(\\b([Ee]l|[Ll]a|[Uu]n|[Uu]na)\\s+)?\\b${sigla.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
        (_m: string, conArticulo: string | undefined, articulo: string | undefined) => {
          if (!conArticulo || !articulo) return largo.toLowerCase();
          // Se respeta si era definido o indefinido: «una RM» no puede salir
          // «la requisicion», que dice otra cosa.
          const indefinido = /^[Uu]n/.test(articulo);
          const mayuscula = /^[A-Z]/.test(articulo);
          const nuevo = indefinido
            ? (femenino ? "una" : "un")
            : (femenino ? "la" : "el");
          return `${mayuscula ? nuevo[0].toUpperCase() + nuevo.slice(1) : nuevo} ${largo.toLowerCase()}`;
        },
      ] as unknown as [RegExp, string];
    });
}

/**
 * Lo que el sistema escribe corto y una persona dice largo.
 *
 * Nadie dice «eme te be efe»: dice «tiempo medio entre fallas». Y «h.
 * hombre» escrito es comodo, pero oido es un ruido. Van con los limites de
 * palabra puestos para no destrozar un texto que mencione otra cosa.
 *
 * El orden importa: lo mas largo primero, para que «h. hombre» no se coma la
 * «h» antes de tiempo.
 */
const ABREVIATURAS: Array<[RegExp, string]> = [
  [/\bh\.?\s*hombre\b/gi, "horas hombre"],
  [/\bHH\b/g, "horas hombre"],
  [/\bKPI[s]?\b/gi, "indicadores"],
  [/\bRPM\b/gi, "revoluciones por minuto"],
  [/\bkWh?\b/g, "kilowatts"],
  [/\bkVA\b/gi, "kilovoltamperes"],
  [/\bHP\b/g, "caballos de fuerza"],
  [/\bPSI\b/gi, "libras por pulgada cuadrada"],
  [/°\s?C\b/g, " grados centígrados"],
  [/\bN[°º]\s?/g, "número "],
  [/\bcant\.\s*/gi, "cantidad "],
  [/\bprom\.\s*/gi, "promedio "],
  [/\bmáx\.\s*/gi, "máximo "],
  [/\bmín\.\s*/gi, "mínimo "],
  [/\baprox\.\s*/gi, "aproximadamente "],
  [/\bp\.\s?ej\.\s*/gi, "por ejemplo "],
  [/\betc\./gi, "etcétera"],
  [/\bpza[s]?\b/gi, "piezas"],
  [/\bhrs?\.?\b/gi, "horas"],
  [/\bc\/u\b/gi, "cada uno"],
  [/\bc\/?\s?d[ií]a\b/gi, "cada día"],
];

/**
 * Un texto escrito para leerse, listo para decirse.
 *
 * Lo que se lee bien no se oye bien. Una respuesta del sistema trae importes
 * con signo y comas, porcentajes, guiones largos y vinetas; dichos tal cual
 * suenan a maquina deletreando. Aqui se traducen a como los diria una
 * persona, y vive en un solo lugar porque lo necesitan el parte del dia y
 * las respuestas habladas.
 *
 * Deliberadamente NO toca los codigos de equipo —CMP-301, BOM-602—: deben
 * oirse tal cual, porque es como se llaman en la planta.
 */
export function paraDecir(texto: string): string {
  let t = texto;

  // Los folios primero, antes de que las abreviaturas toquen sus letras.
  //
  // Si el texto YA trae articulo —«la OT-000040»— se conserva el suyo y solo
  // se pone el sustantivo; si no, se pone el articulo completo. Sin esto
  // salia «la la orden 40».
  for (const [prefijo, comoSeDice] of Object.entries(FOLIOS)) {
    const sustantivo = comoSeDice.replace(/^(la|el) /, "");
    t = t.replace(
      new RegExp(`(\\b(?:[Ll]a|[Ee]l|[Ll]as|[Ll]os|[Uu]na|[Uu]n)\\s+)?\\b${prefijo}-0*(\\d+)`, "g"),
      (_, articulo: string | undefined, n: string) =>
        articulo ? `${articulo}${sustantivo} ${n}` : `${comoSeDice} ${n}`,
    );
  }
  // El glosario manda en el vocabulario del oficio; la lista de abajo cubre
  // lo que no es termino sino escritura corta: unidades, «cant.», «h. hombre».
  for (const [patron, comoSeDice] of siglasDelGlosario()) t = t.replace(patron, comoSeDice as unknown as string);
  for (const [patron, comoSeDice] of ABREVIATURAS) t = t.replace(patron, comoSeDice);

  return t
    // Importes: $128,400.50 → 128 mil 400 pesos. Si el texto YA decia «pesos»
    // detras, no se repite: «$45 pesos» no puede salir «45 pesos pesos».
    .replace(/\$\s?([\d,]+)(?:\.\d+)?(\s*pesos)?/gi, (_, n: string) => `${miles(Number(n.replace(/,/g, "")))} pesos`)
    // Porcentajes: 87.5% → 87.5 por ciento
    .replace(/(\d)\s?%/g, "$1 por ciento")
    // Vinetas al empezar un renglon: se oirian como «guion». Se quitan, pero
    // el renglon se cierra con punto —si no, dos vinetas seguidas se dicen
    // de corrido y suenan como una sola frase sin sentido.
    .replace(/^[\s]*[-•*]\s+(.*)$/gm, (_, linea: string) => (/[.:;!?]$/.test(linea.trim()) ? linea : `${linea.trim()}.`))
    // Guiones largos: una coma es la pausa que haria una persona.
    .replace(/\s*[—–]\s*/g, ", ")
    // Encabezados de markdown y negritas, que el modelo a veces cuela.
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** La huella del audio: si cambia el texto, la voz o el ritmo, es otro archivo. */
export function huella(texto: string, voz: string): string {
  return createHash("sha256").update(`${voz}|${RITMO}|${texto}`).digest("hex").slice(0, 32);
}

function rutaDe(organizationId: string, texto: string, voz: string): string {
  return `org-${organizationId}/voz/${huella(texto, voz)}.mp3`;
}

export type Sintesis = {
  audio: Buffer;
  /** De donde salio: recien sintetizado o del guardado. */
  origen: "nuevo" | "guardado";
  /** Lo que costo esta vez. Cero cuando venia guardado. */
  costoUsd: number;
};

/** Treinta dolares por millon de caracteres (Chirp 3 HD, tarifa publicada). */
const USD_POR_CARACTER = 30 / 1_000_000;

/**
 * El parte, en audio.
 *
 * Devuelve nulo cuando no se puede sintetizar —sin credenciales, error de la
 * API, idioma no disponible—. Nulo NO es un error que haya que enseñar: la
 * pantalla se queda con la voz del aparato y la persona igual escucha su
 * parte. Que se caiga la voz bonita no puede dejar a nadie sin su informacion.
 */
export async function sintetizar(
  organizationId: string,
  texto: string,
  /** La voz que escogio la persona. Sin ella, la de omision. */
  clave?: string | null,
  /** Quien la pidio, para que el consumo se pueda ver por persona. */
  userId?: string | null,
  /** El plan, para el tope del mes. Sin el, no se topa: el parte no puede
   *  quedarse mudo porque quien llama olvido pasarlo. */
  plan?: string | null,
): Promise<Sintesis | null> {
  if (!texto.trim()) return null;
  const voz = nombreDeVoz(clave);
  // La voz entra en la huella: al cambiarla, el audio guardado deja de servir
  // y se regenera solo. Sin esto, cambiar de voz no se oiria hasta que
  // cambiara el texto.
  const ruta = rutaDe(organizationId, texto, voz);

  // Lo guardado primero: el mismo parte se oye varias veces.
  try {
    const guardado = await leerArchivo(ruta);
    if (guardado?.length) return { audio: guardado, origen: "guardado", costoUsd: 0 };
  } catch {
    // No estaba. Se sintetiza.
  }

  if (!vozConfigurada()) return null;

  /**
   * El tope se revisa DESPUES de buscar lo guardado, a proposito.
   *
   * Volver a oir un audio que ya existe no le cuesta nada a nadie, asi que
   * seria absurdo negarlo por haber llegado al maximo del mes. Lo que se
   * frena es generar audio nuevo, que es lo unico que se paga.
   */
  if (plan) {
    const veredicto = await puedeHablar({ id: organizationId, plan });
    if (!veredicto.puede) {
      console.warn(`[voz] tope del mes alcanzado en ${organizationId}`);
      return null;
    }
  }

  try {
    /**
     * El proyecto al que se le cobra, fijado antes de construir el cliente.
     *
     * No basta pasarlo como opcion: la libreria lo toma del archivo de
     * credenciales, y en esta maquina ese archivo apunta al otro sistema. La
     * variable manda sobre el archivo y vive solo en este proceso, igual que
     * CLOUDSDK_CORE_PROJECT en los scripts. En Cloud Run no cambia nada: ahi
     * la cuenta de servicio ya es la del proyecto correcto.
     */
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= PROYECTO;
    const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
    const cliente = new TextToSpeechClient({ projectId: PROYECTO });
    const markup = conPausas(texto);
    const [respuesta] = await cliente.synthesizeSpeech({
      input: { markup },
      voice: { languageCode: IDIOMA, name: voz },
      audioConfig: { audioEncoding: "MP3", speakingRate: RITMO },
    });
    const contenido = respuesta.audioContent;
    if (!contenido) return null;
    const audio = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido as Uint8Array);

    // Se guarda sin esperar: si falla el guardado, el audio ya se entrego y la
    // proxima vez se vuelve a sintetizar. Molesto, no roto.
    await guardarArchivo(ruta, audio, TIPO).catch(() => undefined);

    // Lo que costo queda registrado: sin medicion no hay forma de poner un
    // tope, ni de saber quien gasta.
    const costoUsd = markup.length * USD_POR_CARACTER;
    const { registrarVoz } = await import("./ia/consumo");
    await registrarVoz({ organizationId, userId, voz, caracteres: markup.length, costoUsd }).catch(() => undefined);

    return { audio, origen: "nuevo", costoUsd };
  } catch (e) {
    /**
     * Que la voz falle NO puede tumbar el parte, pero tampoco puede quedarse
     * callada. Sin este registro, un permiso mal puesto en produccion dejaria
     * a todos oyendo la voz del aparato para siempre, sin un solo error en
     * pantalla y sin que nadie lo notara. Queda en los registros de Cloud Run.
     */
    console.error("[voz] no se pudo sintetizar:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ─────────────────────────────── Quien puede hablar, y cuanto ───────────────

/**
 * Cuantos audios al mes puede generar una empresa.
 *
 * El tope no existe para racionar al cliente: existe porque el costo de la
 * voz lo paga la plataforma, no el. Una pregunta hablada cuesta centavos,
 * pero un usuario intensivo —veinte al dia— llega a doscientos pesos al mes,
 * la quinta parte de lo que deja el complemento. Con tres asi, deja de ser
 * negocio.
 *
 * Al llegar al tope se apaga la voz y se dice; NO se apaga nada mas. Quedarse
 * sin escuchar el parte es un inconveniente, quedarse sin ver sus ordenes
 * seria un despropósito.
 */
export const TOPE_VOZ_MENSUAL: Record<string, number> = {
  PROFESSIONAL: 300,
  ENTERPRISE: 1500,
};

/**
 * El chat con voz es solo de Enterprise.
 *
 * Es lo caro —transcribir, pensar y hablar en cada vuelta— y es donde el
 * gasto se dispara sin que nadie lo note. El parte hablado y el boton de
 * escuchar una respuesta no: esos ya se entregaron a todos y cuestan una
 * fraccion.
 */
export const PLANES_CON_CHAT_DE_VOZ = ["ENTERPRISE"];

export function tieneChatDeVoz(plan: string | null | undefined): boolean {
  return PLANES_CON_CHAT_DE_VOZ.includes(plan ?? "");
}

export type VeredictoDeVoz =
  | { puede: true; restantes: number }
  | { puede: false; motivo: string; restantes: 0 };

/**
 * Si a esta empresa todavia le toca hablar este mes.
 *
 * Cuenta los audios que ya genero, no los caracteres: es lo que una persona
 * entiende —«le quedan 40 de 300»— y lo que se puede enseñar en una pantalla
 * sin explicar nada.
 */
export async function puedeHablar(org: { id: string; plan: string }): Promise<VeredictoDeVoz> {
  const tope = TOPE_VOZ_MENSUAL[org.plan] ?? TOPE_VOZ_MENSUAL.PROFESSIONAL;
  const { prisma } = await import("./db");
  const { periodoActual } = await import("./ia/consumo");

  const usados = await prisma.aiUsage.count({
    where: { organizationId: org.id, funcion: "VOZ", periodo: periodoActual() },
  });
  const restantes = Math.max(tope - usados, 0);
  if (restantes > 0) return { puede: true, restantes };

  return {
    puede: false,
    restantes: 0,
    motivo: `Se llegó al máximo de ${tope} audios de este mes. El siguiente mes se reinicia; lo demás del sistema sigue igual.`,
  };
}

// ─────────────────────────────── Las frases de la conversacion ─────────────

/**
 * Lo que el sistema dice sin tener que pensarlo.
 *
 * El saludo y el «deme un momento» NO los escribe el modelo: son siempre lo
 * mismo, asi que pedirselos seria pagar una operacion para que invente otra
 * forma de decir «buenos dias». Como son texto fijo, el audio se guarda una
 * sola vez y toda la empresa lo reusa para siempre.
 *
 * El acuse importa mas de lo que parece. Entre la pregunta y la respuesta
 * pasan segundos —se transcribe, se consulta, se sintetiza— y un silencio
 * largo se siente como que se descompuso. Decir «deme un momento» convierte
 * la espera en alguien trabajando.
 */
export const FRASES = {
  saludo: (nombre: string) => `Buen día, ${nombre.split(" ")[0]}. ¿En qué le ayudo?`,
  pensando: "Claro, déjeme revisar sus datos.",
  sinDatos: "No encontré con qué contestar eso. ¿Lo intentamos de otra forma?",
  tope: "Por hoy ya no puedo hablar más. Lo escrito sigue funcionando igual.",
} as const;
