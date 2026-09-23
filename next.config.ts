import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: { serverActions: { bodySizeLimit: "5mb" } },

  /**
   * Cabeceras de seguridad.
   *
   * Son las que revisa cualquier escaneo de un area de sistemas antes de
   * autorizar una compra, y su ausencia se lee como descuido aunque el
   * sistema sea solido por dentro.
   *
   * No se incluye todavia una Content-Security-Policy completa: Next inyecta
   * estilos y scripts en linea, y una politica mal calibrada rompe la
   * aplicacion en produccion sin avisar. Se hara con su propia prueba.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // La conexion siempre por TLS, tambien en visitas posteriores.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Sin adivinar el tipo de contenido: evita que un archivo subido se
          // interprete como script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nadie puede incrustar la aplicacion en un marco ajeno.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // No se filtra la ruta interna al salir hacia un sitio externo.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Se apagan capacidades del navegador que la aplicacion no usa.
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },

  /**
   * El vigilante de archivos no mira la base de datos de desarrollo.
   *
   * ── El defecto que esto arregla, y costo meses ──
   *
   * `prisma/dev.db` vive DENTRO del proyecto, y en desarrollo pesa mas de cien
   * megas. El vigilante de `next dev` la veia cambiar en cada escritura y
   * recompilaba —«Compiled in 140ms (328 modules)»—. Mientras recompila, Next
   * reescribe sus manifiestos JSON; una peticion que llegara en ese instante
   * leia uno a medias y moria con «SyntaxError: Unexpected end of JSON input»,
   * que sale como un **500**.
   *
   * De ahi el 500 esporadico que tumbaba una prueba al azar dentro de la suite
   * completa y que nunca aparecia corriendola sola: sola escribe poco, la
   * suite escribe sin parar. La prueba lo reportaba como lo que estuviera
   * revisando —«el supervisor pudo dar de alta un usuario»— cuando lo que
   * hubo fue la pagina tronando.
   *
   * Se persiguio durante meses desde el lado del cliente, mirando el status,
   * porque las pruebas levantaban su servidor con `stdio: "ignore"` y tiraban
   * justo el mensaje que lo explicaba.
   *
   * La cadena esta comprobada: con el servidor levantado y nadie tocando
   * codigo, un `touch prisma/dev.db` provoca la recompilacion.
   *
   * Solo en desarrollo: en produccion no hay vigilante, y la base es
   * PostgreSQL, que ni siquiera es un archivo.
   */
  webpack: (config, { dev }) => {
    if (!dev) return config;
    /**
     * La lista se escribe entera, no se hereda.
     *
     * Lo que Next trae en `watchOptions.ignored` es una expresion regular, y
     * webpack exige que si es arreglo sean TODAS cadenas: mezclarlas tumba el
     * servidor al arrancar con «ignored[0] should be a non-empty string». Por
     * eso van los globs equivalentes de node_modules y .git tambien, o se
     * perderia lo que esa regla ya excluia.
     */
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        // El diario y los archivos de escritura anticipada de SQLite cambian
        // mas seguido que la base misma: sin ellos el arreglo queda a medias.
        "**/prisma/*.db",
        "**/prisma/*.db-journal",
        "**/prisma/*.db-wal",
        "**/prisma/*.db-shm",
      ],
    };
    return config;
  },

};

export default nextConfig;
