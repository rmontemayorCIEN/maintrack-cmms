/**
 * Buscar texto sin distinguir mayusculas, en los dos motores.
 *
 * El defecto que origino esto: desarrollo corre en SQLite, donde `LIKE` es
 * insensible a mayusculas por omision, y produccion en PostgreSQL, donde NO
 * lo es. En la Mac, buscar «bomba» encontraba «Bomba»; en produccion, no
 * encontraba nada. El buscador parecia roto y ninguna prueba local lo veia,
 * porque localmente funcionaba.
 *
 * `mode: "insensitive"` es la solucion de Prisma, pero no existe en los tipos
 * que genera para SQLite: escribirlo en cada pantalla rompe el typecheck en
 * desarrollo. Por eso el objeto se arma aqui, una sola vez, y las pantallas
 * llaman a `contiene(q)` sin saber en que motor corren.
 *
 * Los acentos son otra cosa y no se resuelven aqui: «bomba» no encuentra
 * «bómba» en ninguno de los dos. La busqueda global (`lib/busqueda.ts`) si
 * los normaliza, a costa de traer las filas y filtrarlas en memoria.
 */

/**
 * PostgreSQL distingue mayusculas en LIKE; SQLite no.
 *
 * Se decide por como EMPIEZA la cadena de conexion, y se toma SQLite cuando
 * la variable no esta: los scripts sueltos (`npx tsx scripts/...`) no la
 * traen en el entorno —Prisma lee el archivo .env por su cuenta— y mandarle
 * `mode` al cliente de SQLite lo hace reventar. Produccion siempre la tiene,
 * porque llega de Secret Manager, y `con-produccion.sh` tambien la exporta.
 */
const DISTINGUE_MAYUSCULAS = /^postgres/.test(process.env.DATABASE_URL ?? "");

/**
 * Filtro «contiene este texto», insensible a mayusculas donde haga falta.
 *
 * El tipo declarado es el minimo comun de los dos motores para que compile
 * con el cliente de SQLite; la propiedad extra viaja igual y PostgreSQL la
 * aplica.
 */
export function contiene(texto: string): { contains: string } {
  return (DISTINGUE_MAYUSCULAS
    ? { contains: texto, mode: "insensitive" }
    : { contains: texto }) as { contains: string };
}
