import type { MetadataRoute } from "next";

/**
 * El manifiesto que convierte a MainTrack en una aplicacion instalable.
 *
 * Sin esto, en iPhone NO existen los avisos: Safari solo los entrega si el
 * sitio se agrego a la pantalla de inicio, y solo ofrece agregarlo cuando hay
 * manifiesto con iconos. En Android habilita el "Instalar aplicacion".
 *
 * `display: standalone` la abre sin barra de direcciones, que es lo que hace
 * que se sienta aplicacion y no pagina. `start_url` apunta al tablero porque
 * quien la instala ya tiene sesion; la pantalla de acceso solo estorbaria.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MainTrack CMMS",
    short_name: "MainTrack",
    description:
      "Mantenimiento preventivo, correctivo y predictivo. Órdenes de trabajo, reportes de falla y refacciones desde el celular.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1f3eee",
    lang: "es-MX",
    dir: "ltr",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // El recortable va aparte y a sangre: si se declara el mismo icono como
      // "any maskable", Android le recorta las esquinas al redondeado y queda
      // un borde mordido.
      { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Reportar una falla", short_name: "Reportar", url: "/requests?nueva=1" },
      { name: "Mis órdenes de trabajo", short_name: "Órdenes", url: "/work-orders" },
    ],
  };
}
