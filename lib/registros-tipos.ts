/**
 * Registros propios: de que esta hecha una tabla que armo el cliente.
 *
 * Vive aparte de `lib/registros.ts` a proposito: el armador de tablas y las
 * pantallas de captura son componentes de cliente y solo necesitan estos
 * nombres y estas validaciones. Si los tomaran del modulo con la logica, el
 * empaquetador arrastraria prisma al paquete del navegador y la compilacion
 * se cae con un «no encuentro net» que no dice nada de la causa. Es el mismo
 * criterio de `lib/vigencias-tipos.ts`, `lib/estados-compra.ts` y
 * `lib/cierre-tipos.ts`.
 *
 * ── Por que un constructor, y con que frenos
 *
 * Cada empresa lleva en Excel media docena de cosas que ni su ERP ni el CMMS
 * tienen: la bitacora del diesel, la entrega de equipo de proteccion, el
 * analisis del agua de la torre. No son mantenimiento y no van a ser modulos,
 * pero se consultan junto al equipo y se pierden en el Excel de una sola
 * persona.
 *
 * Un constructor generico cobra caro: el esquema se vuelve datos y se pierden
 * tipo e integridad, y la IA se queda muda porque una tabla inventada no
 * tiene semantica. Los tres frenos que lo hacen sostenible estan aqui:
 *
 * 1. Los valores NO se guardan como JSON, sino en columnas tipadas. Un numero
 *    vive en `numero` y una fecha en `fecha`, asi que se puede sumar, filtrar
 *    y ordenar de verdad. Un JSON se ve mas simple y convierte cualquier
 *    reporte en un recorrido en memoria.
 * 2. Los tipos de campo son un catalogo CERRADO, este. El cliente elige de
 *    aqui; no inventa tipos.
 * 3. Tanto la tabla como cada campo exigen una descripcion en español. Eso es
 *    lo que la IA lee para saber que significa la columna, y lo que la ayuda
 *    muestra. Sin descripcion, una tabla llamada «Control 2» es ilegible para
 *    el sistema y para el companero que entra el año que viene.
 */

import type { Permission } from "./rbac";

// ─────────────────────────────────────────── Quien ve y quien captura

/**
 * Los roles que ven una tabla se guardan en una cadena separada por comas:
 * el esquema corre en SQLite y en PostgreSQL con el mismo archivo, asi que no
 * hay arreglos nativos.
 */
export const SEPARADOR_ROLES = ",";

export const rolesDe = (tabla: { rolesVer: string }): string[] =>
  tabla.rolesVer.split(SEPARADOR_ROLES).map((r) => r.trim()).filter(Boolean);

export const textoDeRoles = (roles: string[]): string =>
  roles.map((r) => r.trim()).filter(Boolean).join(SEPARADOR_ROLES);

/** ¿Este rol ve esta tabla? El super-admin ve todo, como en el resto del sistema. */
export function puedeVerTabla(
  rol: string | undefined,
  tabla: { rolesVer: string },
  opciones: { esSuperAdmin?: boolean } = {},
): boolean {
  if (opciones.esSuperAdmin) return true;
  if (!rol) return false;
  return rolesDe(tabla).includes(rol);
}

/**
 * Los permisos que se pueden elegir para una tabla propia.
 *
 * Es un subconjunto a proposito: no tiene sentido gobernar una bitacora con
 * «billing:manage», y ofrecer los veinte permisos del sistema invitaba a
 * elegir mal. Cada uno se describe por QUIEN queda dentro, que es la pregunta
 * que de verdad se hace quien arma la tabla.
 */
export const PERMISOS_DE_TABLA: Array<{ permiso: Permission; etiqueta: string; explica: string }> = [
  { permiso: "workorder:execute", etiqueta: "Quien ejecuta trabajo", explica: "Técnicos, supervisión y administración. Es lo normal para una bitácora que se llena en campo." },
  { permiso: "request:create", etiqueta: "Cualquiera con acceso", explica: "Suma a quien solo reporta. Para registros que llena gente de otras áreas." },
  { permiso: "inventory:write", etiqueta: "Quien mueve almacén", explica: "Técnicos y almacén. Para lo que se entrega, se resguarda o se consume." },
  { permiso: "workorder:write", etiqueta: "Supervisión y arriba", explica: "Deja fuera al técnico. Para lo que se autoriza o se revisa." },
  { permiso: "settings:write", etiqueta: "Solo administración", explica: "Dueño y administradores. Para datos sensibles o contables." },
];

export const esPermisoDeTabla = (p: string): boolean => PERMISOS_DE_TABLA.some((x) => x.permiso === p);

// ─────────────────────────────────────────── Donde se guarda cada valor

/** La columna de `ValorPropio` donde vive el dato, segun el tipo del campo. */
export const COLUMNAS_VALOR = ["texto", "numero", "fecha", "booleano", "refId"] as const;
export type ColumnaValor = (typeof COLUMNAS_VALOR)[number];

/**
 * A que catalogo de MainTrack apunta un campo llave.
 *
 * Esto es lo que distingue un registro propio de una hoja de calculo: la
 * columna «equipo» no es texto que alguien escribio, es EL equipo. Por eso el
 * consumo de diesel de un generador se puede ver en el expediente de ese
 * generador, y el Excel nunca pudo.
 */
export const LLAVES = ["asset", "part", "user", "location", "site", "supplier", "centroDeCosto", "workOrder"] as const;
export type Llave = (typeof LLAVES)[number];

export type DefinicionCampo = {
  nombre: string;
  /** Una linea: que es, para quien arma la tabla. */
  descripcion: string;
  columna: ColumnaValor;
  /** Si apunta a un catalogo de MainTrack, a cual. */
  llave?: Llave;
  /** Si hay que capturarle una lista de opciones al definirlo. */
  pideOpciones?: boolean;
  /** Los numeros y el dinero se alinean a la derecha y se pueden sumar. */
  numerico?: boolean;
  /** Largo maximo del texto. Se rechaza al capturar, no se recorta callado. */
  maxLargo?: number;
};

const c = (x: DefinicionCampo) => x;

/**
 * Los tipos de campo que puede usar una tabla propia.
 *
 * El orden es el que se le ofrece a quien arma: primero lo que todos
 * entienden, al final las llaves, que son las que hay que explicar.
 */
export const TIPOS_CAMPO = {
  TEXTO: c({
    nombre: "Texto",
    descripcion: "Una línea: un folio externo, una marca, una observación corta.",
    columna: "texto", maxLargo: 200,
  }),
  TEXTO_LARGO: c({
    nombre: "Texto largo",
    descripcion: "Varios renglones: el detalle de lo que pasó, una nota extensa.",
    columna: "texto", maxLargo: 4000,
  }),
  NUMERO: c({
    nombre: "Número",
    descripcion: "Una cantidad: litros, horas, piezas, grados, ppm. Se puede sumar y promediar.",
    columna: "numero", numerico: true,
  }),
  DINERO: c({
    nombre: "Importe",
    descripcion: "Un monto en la moneda de la empresa. Se suma y se muestra con separadores.",
    columna: "numero", numerico: true,
  }),
  FECHA: c({
    nombre: "Fecha",
    descripcion: "Un día. Se puede ordenar y filtrar por periodo.",
    columna: "fecha",
  }),
  SI_NO: c({
    nombre: "Sí o no",
    descripcion: "Una casilla: se hizo o no se hizo, cumple o no cumple.",
    columna: "booleano",
  }),
  LISTA: c({
    nombre: "Lista de opciones",
    descripcion: "Una de varias opciones que usted define. Sirve para agrupar y para que nadie escriba lo mismo de tres formas.",
    columna: "texto", pideOpciones: true, maxLargo: 200,
  }),
  ACTIVO: c({
    nombre: "Equipo",
    descripcion: "Un equipo del padrón. El registro aparece después en el expediente de ese equipo.",
    columna: "refId", llave: "asset",
  }),
  REFACCION: c({
    nombre: "Refacción",
    descripcion: "Una refacción del catálogo del almacén. No mueve existencia: solo la nombra.",
    columna: "refId", llave: "part",
  }),
  PERSONA: c({
    nombre: "Persona",
    descripcion: "Alguien del personal. Para lo que se entrega, se asigna o se capacita por persona.",
    columna: "refId", llave: "user",
  }),
  UBICACION: c({
    nombre: "Ubicación",
    descripcion: "Una ubicación de la instalación: área, nave, piso.",
    columna: "refId", llave: "location",
  }),
  SITIO: c({
    nombre: "Sitio",
    descripcion: "Una de las plantas o sucursales. Útil cuando la empresa tiene varias.",
    columna: "refId", llave: "site",
  }),
  PROVEEDOR: c({
    nombre: "Proveedor",
    descripcion: "Un proveedor del catálogo: quién surtió, quién prestó el servicio.",
    columna: "refId", llave: "supplier",
  }),
  CENTRO_COSTO: c({
    nombre: "Centro de costo",
    descripcion: "El centro de costo contable. Es lo que permite que el gasto de esta tabla entre a la junta de presupuesto.",
    columna: "refId", llave: "centroDeCosto",
  }),
  ORDEN: c({
    nombre: "Orden de trabajo",
    descripcion: "Una orden de trabajo. Para amarrar el registro al trabajo que lo originó.",
    columna: "refId", llave: "workOrder",
  }),
} as const;

export type TipoCampo = keyof typeof TIPOS_CAMPO;
export const ORDEN_TIPOS_CAMPO = Object.keys(TIPOS_CAMPO) as TipoCampo[];
export const esTipoCampo = (t: string): t is TipoCampo => t in TIPOS_CAMPO;
export const definicionDeCampo = (t: string) => (esTipoCampo(t) ? TIPOS_CAMPO[t] : TIPOS_CAMPO.TEXTO);
export const nombreDeTipoCampo = (t: string) => definicionDeCampo(t).nombre;
export const columnaDeCampo = (t: string): ColumnaValor => definicionDeCampo(t).columna;
export const llaveDeCampo = (t: string): Llave | null => definicionDeCampo(t).llave ?? null;
export const esNumerico = (t: string) => Boolean(definicionDeCampo(t).numerico);

// ─────────────────────────────────────────── Limites

/**
 * Los topes. No son burocracia: son la diferencia entre un modulo y una
 * plataforma que hay que operar.
 *
 * Doce tablas de veinticuatro campos cubren de sobra lo que una planta lleva
 * en Excel. Sin tope, la primera cuenta que descubra el constructor mete
 * ochenta tablas, ninguna con descripcion, y el soporte de eso ya es otro
 * negocio —y otro precio—.
 */
export const LIMITES = {
  tablasPorEmpresa: 12,
  camposPorTabla: 24,
  opcionesPorLista: 30,
  /** Largo del nombre de la tabla y de la etiqueta de un campo. */
  largoNombre: 60,
  largoDescripcion: 400,
} as const;

// ─────────────────────────────────────────── Claves

/**
 * La clave interna de un campo, a partir de su etiqueta.
 *
 * Se fija UNA VEZ, al crear el campo, y no vuelve a cambiar aunque se
 * renombre la etiqueta. Es la regla que evita el defecto obvio: si la clave
 * saliera de la etiqueta cada vez, renombrar «Litros» a «Litros cargados»
 * dejaria huerfanos todos los valores ya capturados y la columna apareceria
 * vacia sin un solo mensaje de error.
 */
export function claveDesde(texto: string): string {
  const sinAcentos = texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const limpia = sinAcentos.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return limpia.slice(0, 40) || "campo";
}

/** Una clave libre dentro de la tabla: si `litros` ya existe, devuelve `litros_2`. */
export function claveLibre(deseada: string, usadas: Iterable<string>): string {
  const tomadas = new Set(usadas);
  if (!tomadas.has(deseada)) return deseada;
  for (let n = 2; n < 100; n++) {
    const intento = `${deseada}_${n}`.slice(0, 40);
    if (!tomadas.has(intento)) return intento;
  }
  return `${deseada}_${Date.now()}`.slice(0, 40);
}

// ─────────────────────────────────────────── Opciones de una lista

/**
 * Las opciones de un campo LISTA se guardan en una sola cadena, un renglon
 * por opcion. No es un arreglo porque el esquema corre en SQLite y en
 * PostgreSQL con el mismo archivo, y no van separadas por coma porque una
 * opcion legitima puede traer coma: «Aceite 15W40, tambo».
 */
export const SEPARADOR_OPCIONES = "\n";

export function opcionesDe(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto.split(SEPARADOR_OPCIONES).map((o) => o.trim()).filter(Boolean);
}

export function textoDeOpciones(opciones: string[]): string {
  return opciones.map((o) => o.trim()).filter(Boolean).join(SEPARADOR_OPCIONES);
}

// ─────────────────────────────────────────── Interpretar lo capturado

export type CampoParaValidar = {
  clave: string;
  etiqueta: string;
  tipo: string;
  requerido?: boolean;
  opciones?: string | null;
};

/** El dato ya tipado, listo para las columnas de `ValorPropio`. */
export type ValorTipado = {
  texto: string | null;
  numero: number | null;
  fecha: Date | null;
  booleano: boolean | null;
  refId: string | null;
};

export const VALOR_VACIO: ValorTipado = { texto: null, numero: null, fecha: null, booleano: null, refId: null };

const SI = new Set(["true", "1", "si", "sí", "s", "yes", "on"]);
const NO = new Set(["false", "0", "no", "n", "off"]);

const estaVacio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Convierte lo que llego del formulario en el valor tipado del campo.
 *
 * Rechaza con motivo en español en vez de recortar o adivinar. Aqui el que
 * captura es una persona que puede corregir: truncarle el texto sin decirle
 * nada le pierde informacion que ella creia guardada. (El criterio contrario
 * —recortar y no rechazar— aplica a lo que escribe el modelo de IA, donde no
 * hay nadie a quien preguntarle y el trabajo ya se pago.)
 */
export function interpretarValor(
  campo: CampoParaValidar,
  crudo: unknown,
): { ok: true; valor: ValorTipado } | { ok: false; motivo: string } {
  const def = definicionDeCampo(campo.tipo);
  const etiqueta = campo.etiqueta || campo.clave;

  if (estaVacio(crudo)) {
    if (campo.requerido) return { ok: false, motivo: `«${etiqueta}» no puede quedar vacío.` };
    return { ok: true, valor: { ...VALOR_VACIO } };
  }

  switch (def.columna) {
    case "numero": {
      // Se quitan separadores de miles, el signo de pesos y los espacios: la
      // gente escribe «1,250.50» y «$ 1250», y rechazarlo es pelearse con
      // como se escribe un numero en México.
      const texto = String(crudo).replace(/[\s,$]/g, "");
      const n = Number(texto);
      if (!Number.isFinite(n)) return { ok: false, motivo: `«${etiqueta}» tiene que ser un número. Llegó «${String(crudo)}».` };
      return { ok: true, valor: { ...VALOR_VACIO, numero: n } };
    }
    case "fecha": {
      const d = crudo instanceof Date ? crudo : new Date(String(crudo));
      if (Number.isNaN(d.getTime())) return { ok: false, motivo: `«${etiqueta}» tiene que ser una fecha válida.` };
      return { ok: true, valor: { ...VALOR_VACIO, fecha: d } };
    }
    case "booleano": {
      if (typeof crudo === "boolean") return { ok: true, valor: { ...VALOR_VACIO, booleano: crudo } };
      const t = String(crudo).trim().toLowerCase();
      if (SI.has(t)) return { ok: true, valor: { ...VALOR_VACIO, booleano: true } };
      if (NO.has(t)) return { ok: true, valor: { ...VALOR_VACIO, booleano: false } };
      return { ok: false, motivo: `«${etiqueta}» solo acepta sí o no.` };
    }
    case "refId": {
      const id = String(crudo).trim();
      // Que el id EXISTA y sea de esta empresa lo valida `lib/registros.ts`,
      // que es quien puede consultar la base. Aqui solo se ve la forma.
      return { ok: true, valor: { ...VALOR_VACIO, refId: id } };
    }
    default: {
      const t = String(crudo).trim();
      const max = def.maxLargo ?? 200;
      if (t.length > max) {
        return { ok: false, motivo: `«${etiqueta}» admite hasta ${max} caracteres y llegaron ${t.length}.` };
      }
      if (campo.tipo === "LISTA") {
        const opciones = opcionesDe(campo.opciones);
        if (opciones.length && !opciones.includes(t)) {
          return { ok: false, motivo: `«${t}» no es una de las opciones de «${etiqueta}».` };
        }
      }
      return { ok: true, valor: { ...VALOR_VACIO, texto: t } };
    }
  }
}

/** El valor tipado de vuelta a algo que se pinta. Nulo cuando no hay dato. */
export function valorCrudo(tipo: string, valor: Partial<ValorTipado> | null | undefined): string | number | boolean | Date | null {
  if (!valor) return null;
  switch (columnaDeCampo(tipo)) {
    case "numero": return valor.numero ?? null;
    case "fecha": return valor.fecha ?? null;
    case "booleano": return valor.booleano ?? null;
    case "refId": return valor.refId ?? null;
    default: return valor.texto ?? null;
  }
}

// ─────────────────────────────────────────── Validar la definicion

export type DefinicionParaValidar = {
  nombre: string;
  descripcion: string;
  campos: Array<{ etiqueta: string; tipo: string; opciones?: string | null }>;
};

/**
 * Los problemas de una tabla antes de guardarla, todos de un golpe.
 *
 * Devuelve la lista completa y no el primero: quien arma una tabla de doce
 * campos no merece descubrir los errores de uno en uno.
 */
export function problemasDeDefinicion(d: DefinicionParaValidar): string[] {
  const problemas: string[] = [];
  const nombre = d.nombre?.trim() ?? "";
  const descripcion = d.descripcion?.trim() ?? "";

  if (!nombre) problemas.push("La tabla necesita nombre.");
  else if (nombre.length > LIMITES.largoNombre) problemas.push(`El nombre admite hasta ${LIMITES.largoNombre} caracteres.`);

  // La descripcion no es cortesia: es lo que la IA lee para saber que
  // significa esta tabla, y lo que ve quien entra el año que viene.
  if (!descripcion) problemas.push("Explique en una línea para qué es esta tabla: es lo que lee la ayuda y la IA para poder contestar sobre ella.");
  else if (descripcion.length > LIMITES.largoDescripcion) problemas.push(`La explicación admite hasta ${LIMITES.largoDescripcion} caracteres.`);

  if (!d.campos?.length) problemas.push("La tabla necesita al menos un campo.");
  if (d.campos && d.campos.length > LIMITES.camposPorTabla) {
    problemas.push(`Una tabla admite hasta ${LIMITES.camposPorTabla} campos y se definieron ${d.campos.length}.`);
  }

  const vistas = new Set<string>();
  for (const campo of d.campos ?? []) {
    const etiqueta = campo.etiqueta?.trim() ?? "";
    if (!etiqueta) { problemas.push("Hay un campo sin nombre."); continue; }
    if (etiqueta.length > LIMITES.largoNombre) problemas.push(`«${etiqueta}» admite hasta ${LIMITES.largoNombre} caracteres.`);
    if (!esTipoCampo(campo.tipo)) problemas.push(`«${etiqueta}» tiene un tipo que no existe: ${campo.tipo}.`);

    // Dos columnas con el mismo nombre no son un detalle estetico: se
    // convierten en la misma clave y una se come a la otra.
    const clave = claveDesde(etiqueta);
    if (vistas.has(clave)) problemas.push(`Hay dos campos que se llaman igual: «${etiqueta}».`);
    vistas.add(clave);

    if (campo.tipo === "LISTA") {
      const opciones = opcionesDe(campo.opciones);
      if (opciones.length < 2) problemas.push(`«${etiqueta}» es una lista y necesita al menos dos opciones.`);
      if (opciones.length > LIMITES.opcionesPorLista) {
        problemas.push(`«${etiqueta}» admite hasta ${LIMITES.opcionesPorLista} opciones.`);
      }
      if (new Set(opciones).size !== opciones.length) problemas.push(`«${etiqueta}» tiene opciones repetidas.`);
    }
  }

  return problemas;
}
