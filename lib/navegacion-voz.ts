/**
 * Llevar a alguien a donde pidio, hablando.
 *
 * ── Por que esto NO le pregunta al modelo ──
 *
 * «Llevame al almacen» tiene formula: hay una lista finita de pantallas y una
 * busqueda que ya existe. Preguntarle a un modelo costaria unos centavos por
 * comando y, peor, tardaria dos o tres segundos —el tiempo justo para que
 * alguien piense que no lo oyo y lo repita—. Es la misma regla con la que los
 * minimos de inventario se calculan y no se consultan: la IA es para lo que no
 * tiene formula.
 *
 * Lo que NO se entienda se dice y se registra. Si resulta que la gente habla de
 * formas que estos patrones no cubren, ahi si tiene sentido un modelo de
 * respaldo, y para entonces habra con que decidirlo.
 *
 * ── Este archivo no importa nada del servidor ──
 *
 * A proposito: lo usan la ruta y tambien la prueba, y podria usarlo el
 * navegador. Es el criterio de `lib/pantallas.ts` y `lib/motivos-movimiento.ts`
 * —arrastrar prisma al cliente rompe la compilacion con un «no encuentro tls»
 * que no dice nada de la causa—.
 */

/** Sin acentos, sin mayusculas, sin signos. Igual que la busqueda general. */
export function normalizar(t: string): string {
  return (t ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Las formas de pedir que lo lleven a uno.
 *
 * Van de la mas larga a la mas corta a proposito: si «ir a» se probara antes
 * que «quiero ir a», de «quiero ir a compras» quedaria «quiero» pegado al
 * destino y no coincidiria con nada.
 */
const VERBOS = [
  "quiero ir a", "quiero ver", "me puedes llevar a", "puedes llevarme a",
  "llevame a la", "llevame al", "llevame a", "llevame",
  "abreme la", "abreme el", "abreme", "abre la", "abre el", "abre",
  "ensename la", "ensename el", "ensename", "muestrame la", "muestrame el", "muestrame",
  "vamos a la", "vamos al", "vamos a",
  "ve a la", "ve al", "ve a",
  "ir a la", "ir al", "ir a",
  "entra a la", "entra al", "entra a",
  "busca", "buscame",
];

/**
 * Quita el verbo y deja el destino.
 *
 * Tambien quita los articulos que sobran al principio: «llevame a las ordenes»
 * deja «las ordenes», y el catalogo guarda «ordenes».
 *
 * Los posesivos NO se quitan, y esto costo un defecto. «Mis» estaba en la
 * lista de articulos, asi que «mis ordenes» quedaba en «ordenes» y llevaba a
 * la lista completa: la persona veia todas las ordenes de la planta creyendo
 * que eran las suyas, sin un solo error en pantalla. Un posesivo no es un
 * articulo de relleno —es la mitad de lo que se pidio—.
 */
export function quitarVerbo(frase: string): string {
  let t = normalizar(frase);
  for (const v of VERBOS) {
    if (t.startsWith(`${v} `) || t === v) {
      t = t.slice(v.length).trim();
      break;
    }
  }
  return t.replace(/^(el|la|los|las|un|una)\s+/, "").trim();
}

/**
 * Palabras que anuncian a que se refiere, pero no son parte del nombre.
 *
 * «Abre el equipo compresor de tornillo» no busca un equipo que se llame
 * «equipo compresor de tornillo»: busca el compresor. Lo mismo con «la orden
 * 124». Se quitan SOLO si queda algo despues —«ordenes» a secas si es un
 * destino, y no hay que dejar la frase vacia—.
 */
const ANUNCIOS = ["equipo", "activo", "maquina", "orden", "ot", "solicitud", "reporte", "refaccion", "parte"];

/** Quita el anuncio de la cabeza, si deja algo util detras. */
export function quitarAnuncio(texto: string): string {
  const palabras = texto.split(" ");
  if (palabras.length > 1 && ANUNCIOS.includes(palabras[0])) return palabras.slice(1).join(" ").trim();
  return texto;
}

export type Destino = {
  ruta: string;
  /** Como se le dice en pantalla al confirmar: «Lo llevo a Almacén». */
  titulo: string;
  /** Todas las formas en que alguien puede nombrarla, ya normalizadas. */
  nombres: string[];
};

/**
 * Las pantallas, con los nombres que la gente usa de verdad.
 *
 * No son los titulos del menu: son las palabras que alguien dice en voz alta.
 * Al almacen le dicen «refacciones», «inventario» y «almacen», y las tres
 * tienen que llevar al mismo lado. Un catalogo con solo el nombre oficial
 * falla justo con quien no se sabe el nombre oficial, que es todo el mundo.
 *
 * Las rutas salen de `lib/pantallas.ts`, que es donde viven de verdad; aqui
 * solo se les ponen nombres. Cual ve cada quien lo decide esa tabla, no esta.
 */
export const DESTINOS: Destino[] = [
  { ruta: "/dashboard", titulo: "Inicio", nombres: ["inicio", "tablero", "dashboard", "principal", "mi dia", "pantalla principal", "el parte del dia", "parte del dia"] },
  { ruta: "/work-orders", titulo: "Órdenes de trabajo", nombres: ["ordenes", "ordenes de trabajo", "ots", "trabajos", "ordenes de servicio"] },
  { ruta: "/requests", titulo: "Solicitudes", nombres: ["solicitudes", "solicitudes de servicio", "reportes", "reportes de falla", "peticiones"] },
  { ruta: "/assets", titulo: "Activos", nombres: ["activos", "equipos", "maquinas", "maquinaria", "inventario de equipos"] },
  { ruta: "/plans", titulo: "Planes de mantenimiento", nombres: ["planes", "planes de mantenimiento", "preventivos", "programa de mantenimiento"] },
  { ruta: "/inventory", titulo: "Almacén", nombres: ["almacen", "refacciones", "inventario", "existencias", "partes"] },
  { ruta: "/inventory/kardex", titulo: "Kardex", nombres: ["kardex", "movimientos", "movimientos de almacen"] },
  { ruta: "/requisiciones", titulo: "Requisiciones", nombres: ["requisiciones", "vales", "pedidos de material"] },
  { ruta: "/compras", titulo: "Compras", nombres: ["compras", "ordenes de compra", "cotizaciones"] },
  { ruta: "/suppliers", titulo: "Proveedores", nombres: ["proveedores", "provedores"] },
  { ruta: "/calendar", titulo: "Calendario", nombres: ["calendario", "agenda", "programacion"] },
  { ruta: "/board", titulo: "Tablero", nombres: ["tablero de trabajo", "pizarron", "board"] },
  { ruta: "/alerts", titulo: "Alertas", nombres: ["alertas", "avisos de condicion"] },
  { ruta: "/predictive", titulo: "Predictivo", nombres: ["predictivo", "monitoreo", "sensores", "condicion"] },
  { ruta: "/meters", titulo: "Medidores", nombres: ["medidores", "lecturas", "horometros", "contadores"] },
  { ruta: "/paros", titulo: "Paros", nombres: ["paros", "paros de linea", "tiempo muerto", "donde para la planta"] },
  { ruta: "/reports", titulo: "Reportes", nombres: ["reportes generales", "informes"] },
  { ruta: "/indicadores", titulo: "Indicadores", nombres: ["indicadores", "kpis", "metricas", "resultados"] },
  { ruta: "/backlog", titulo: "Trabajo pendiente", nombres: ["pendiente", "trabajo pendiente", "backlog", "rezago"] },
  { ruta: "/equipo", titulo: "Equipo de trabajo", nombres: ["equipo", "personal", "mi gente", "cuadrilla", "tecnicos"] },
  { ruta: "/conjuntos", titulo: "Mapa de líneas", nombres: ["mapa de lineas", "conjuntos", "lineas", "mapa"] },
  { ruta: "/consulta", titulo: "Pregúntale a tus datos", nombres: ["consulta", "preguntale a tus datos", "pregunte a sus datos", "preguntar a mis datos", "preguntar"] },
  { ruta: "/notificaciones", titulo: "Avisos", nombres: ["avisos", "notificaciones", "campana"] },
  { ruta: "/settings", titulo: "Ajustes", nombres: ["ajustes", "configuracion", "preferencias", "mi cuenta"] },
  { ruta: "/catalogs", titulo: "Catálogos", nombres: ["catalogos", "codigos de falla", "causas"] },
  { ruta: "/escanear", titulo: "Escanear", nombres: ["escanear", "escaner", "codigo qr", "qr"] },
  { ruta: "/soporte", titulo: "Soporte", nombres: ["soporte", "ayuda de maintrack", "reportar un problema"] },
  { ruta: "/glossary", titulo: "Glosario", nombres: ["glosario", "diccionario", "que significa"] },
];

/**
 * Atajos con criterio: no llevan a una pantalla, llevan a una pregunta.
 *
 * «Las vencidas» no es un lugar, es un filtro —y uno que la lista de ordenes
 * ya sabe aplicar desde la direccion—. Reusar esos filtros en vez de inventar
 * una pantalla nueva es lo que hace que esto sea barato: la voz solo arma la
 * liga que alguien podria escribir a mano.
 */
export const ATAJOS: Array<{ frases: string[]; ruta: string; titulo: string }> = [
  { frases: ["vencidas", "ordenes vencidas", "atrasadas", "ordenes atrasadas", "lo vencido", "que esta vencido"],
    ruta: "/work-orders?vencidas=1", titulo: "Órdenes vencidas" },
  { frases: ["mis ordenes", "lo mio", "mis trabajos", "mis pendientes", "lo que tengo asignado"],
    ruta: "/work-orders?mias=1", titulo: "Mis órdenes" },
  { frases: ["sin responsable", "ordenes sin responsable", "sin asignar", "lo que no tiene responsable"],
    ruta: "/work-orders?sinResponsable=1", titulo: "Órdenes sin responsable" },
  { frases: ["bajo minimo", "lo que falta en almacen", "refacciones bajo minimo", "lo que se acabo"],
    ruta: "/inventory?estado=bajoMinimo", titulo: "Refacciones bajo mínimo" },
];

/**
 * Lo que pide orden de fecha, que no se resuelve con una liga.
 *
 * «La mas antigua» necesita mirar la base, asi que aqui solo se reconoce la
 * intencion y quien tenga la base la resuelve. Se separa para que este archivo
 * siga sin importar nada.
 */
export type Intencion = { clase: "masAntigua" | "masReciente"; que: "orden" | "solicitud" };

const ANTIGUA = ["mas antigua", "mas vieja", "mas antiguo", "mas viejo", "la primera", "el primero"];
const RECIENTE = ["mas reciente", "mas nueva", "mas nuevo", "la ultima", "el ultimo"];

export function intencionDeOrden(frase: string): Intencion | null {
  const t = quitarVerbo(frase);
  const que: Intencion["que"] | null =
    /\borden|\bot\b|trabajo/.test(t) ? "orden" : /solicitud|reporte/.test(t) ? "solicitud" : null;
  if (!que) return null;
  if (ANTIGUA.some((a) => t.includes(a))) return { clase: "masAntigua", que };
  if (RECIENTE.some((a) => t.includes(a))) return { clase: "masReciente", que };
  return null;
}

/**
 * El destino que corresponde a lo dicho, sin mirar la base.
 *
 * Primero los atajos y luego las pantallas, porque «mis ordenes» tiene que
 * ganarle a «ordenes»: si mandara a la lista completa, el filtro que la
 * persona pidio se perderia en silencio y ella creeria que no tiene nada.
 *
 * La coincidencia es exacta contra los nombres, no por pedazos. «Ordenes de
 * compra» no puede caer en «ordenes» de trabajo solo porque empieza igual: es
 * mejor decir que no se entendio que llevar a alguien al lugar equivocado con
 * seguridad.
 */
function palabras(t: string): string[] {
  return t.split(" ").filter((p) => p.length > 2 && !["del", "las", "los", "una", "con", "por"].includes(p));
}

/**
 * Si lo dicho corresponde a este nombre, sin exigir que sea palabra por
 * palabra.
 *
 * Empezo siendo coincidencia literal, y se quedo corta en cuanto alguien la
 * uso de verdad: «abre solicitudes de servicio» no encontraba «solicitudes»,
 * y «pregunte a sus datos» no encontraba «preguntale a tus datos». Nadie dice
 * los nombres exactos de las pantallas, y menos dictando.
 *
 * Ahora basta con que todas las palabras con peso del nombre esten en lo
 * dicho. «Solicitudes de servicio» contiene «solicitudes»; «pregunte a sus
 * datos» contiene «datos» del nombre «preguntale a tus datos»... y ahi esta
 * el limite: por eso el que gana es el nombre MAS LARGO que encaje, para que
 * una coincidencia de una palabra no le arrebate el destino a una de tres.
 */
function encaja(dicho: string, nombre: string): boolean {
  if (dicho === nombre) return true;
  const suyas = palabras(nombre);
  if (!suyas.length) return false;
  const dichas = palabras(dicho);
  if (!dichas.length) return false;
  return suyas.every((p) => dichas.some((q) => q === p || q.startsWith(p) || p.startsWith(q)));
}

/**
 * Cuando se esta nombrando algo concreto y no una pantalla.
 *
 * «Abre el equipo compresor de tornillo» pide EL compresor, no la pantalla de
 * equipos; «abre la orden 124» pide esa orden, no la lista. Aflojar la
 * coincidencia sin esto los mandaba a la lista, que es peor que no encontrar:
 * la persona llega a una pantalla que se ve bien, no es la que pidio, y a
 * veces ni lo nota.
 *
 * Se distingue por las palabras SOBRANTES: en «orden de trabajo» todo lo dicho
 * cabe en el nombre de la pantalla; en «equipo compresor de tornillo» sobran
 * «compresor» y «tornillo», y eso es justo lo que se esta nombrando.
 */
function nombraAlgoConcreto(dicho: string, nombre: string): boolean {
  const suyas = palabras(nombre);
  return palabras(dicho).some((q) => !suyas.some((p) => q === p || q.startsWith(p) || p.startsWith(q)));
}

export function destinoDe(frase: string): { ruta: string; titulo: string } | null {
  const crudo = quitarVerbo(frase);
  if (!crudo) return null;

  const anuncia = crudo !== quitarAnuncio(crudo);
  // «La orden 124» con un numero de por medio es siempre un registro, nunca
  // una pantalla: se manda derecho a la busqueda.
  if (anuncia && /\d/.test(crudo)) return null;

  const formas = [crudo, quitarAnuncio(crudo)].filter((v, i, a) => v && a.indexOf(v) === i);

  let mejor: { ruta: string; titulo: string; peso: number } | null = null;
  const tomar = () => mejor as { ruta: string; titulo: string; peso: number } | null;
  const proponer = (ruta: string, titulo: string, nombre: string) => {
    const peso = palabras(nombre).length * 10 + nombre.length;
    if (!mejor || peso > mejor.peso) mejor = { ruta, titulo, peso };
  };

  for (const t of formas) {
    // Los atajos primero y con ventaja: «mis ordenes» tiene que ganarle a
    // «ordenes», o el filtro que la persona pidio se pierde en silencio.
    for (const a of ATAJOS) {
      for (const f of a.frases) {
        if (encaja(t, f) && !(anuncia && nombraAlgoConcreto(t, f))) proponer(a.ruta, a.titulo, `${f} ${f}`);
      }
    }
    for (const d of DESTINOS) {
      for (const n of d.nombres) {
        if (encaja(t, n) && !(anuncia && nombraAlgoConcreto(t, n))) proponer(d.ruta, d.titulo, n);
      }
    }
  }
  const m = tomar();
  return m ? { ruta: m.ruta, titulo: m.titulo } : null;
}

/** Ejemplos para cuando no se entendio, para no dejar a nadie adivinando. */
export const EJEMPLOS = [
  "Llévame a las órdenes vencidas",
  "Ábreme el almacén",
  "Enséñame la bomba 3",
  "Ve a mis órdenes",
];
