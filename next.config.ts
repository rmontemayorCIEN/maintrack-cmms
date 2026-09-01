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
};

export default nextConfig;
