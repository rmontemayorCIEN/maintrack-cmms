import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { encabezadosDe, estiloDeApariencia, temaDe } from "@/lib/apariencia";
import { TextosQueCrecen } from "@/components/textos-que-crecen";
import { DESCRIPCION, MARCA } from "@/lib/comercial";

export const metadata: Metadata = {
  title: {
    default: MARCA,
    template: `%s · ${MARCA}`,
  },
  description: DESCRIPCION,
  /**
   * Iconos de la aplicacion instalable. El de Apple va aparte porque iOS
   * ignora el manifiesto para esto y solo lee `apple-touch-icon`.
   */
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  /**
   * Deja que iOS la abra a pantalla completa desde el icono, sin la barra de
   * direcciones de Safari. Ademas es condicion para que el iPhone entregue
   * avisos: solo los recibe una aplicacion agregada a la pantalla de inicio.
   */
  appleWebApp: {
    capable: true,
    title: "MainTrack",
    statusBarStyle: "default",
  },
  /**
   * La etiqueta antigua de Apple, a mano.
   *
   * Next emite solo el nombre moderno —`mobile-web-app-capable`— y las
   * versiones de iOS anteriores a la 17.4 no lo leen: leen esta. Sin ella, en
   * esos iPhone la aplicacion se abre como pestana de Safari aunque este en la
   * pantalla de inicio, y ahi NO llegan los avisos.
   *
   * Es un fallo mudo de los caros: todo se ve bien, el icono esta, la persona
   * jura que la instalo, y nunca recibe nada.
   */
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f3eee",
  width: "device-width",
  initialScale: 1,
};

/**
 * «Igual que mi aparato».
 *
 * El servidor no sabe si el teléfono de la persona está en modo oscuro, así que
 * esto se resuelve en el navegador. Va como script en la cabeza y no como
 * efecto de React porque tiene que correr ANTES del primer pintado: de otro
 * modo la pantalla nace blanca y se oscurece a media carga, que es peor que
 * no tener la opción. Es una sola línea y no depende de nada.
 */
const RESOLVER_TEMA_DEL_SISTEMA =
  `(function(){try{var m=matchMedia("(prefers-color-scheme: dark)");var d=document.documentElement;` +
  `function a(){d.setAttribute("data-tema",m.matches?"oscuro":"claro")}a();m.addEventListener("change",a)}catch(e){}})()`;

/**
 * La apariencia se aplica en el elemento raiz, del lado del servidor.
 *
 * Tiene que ser aqui y no en un componente de cliente: el tamaño de la raiz
 * gobierna todas las medidas relativas, y ajustarlo despues de pintar haria
 * que la pantalla brincara de tamaño en cada carga. Sin sesion —acceso,
 * registro— caen los valores por omision.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  const estilo = estiloDeApariencia({
    escalaUi: user?.escalaUi,
    densidadUi: user?.densidadUi,
    colorAcento: user?.organization?.colorAcento,
  });
  const tema = temaDe(user?.temaUi);

  return (
    // suppressHydrationWarning: con «Igual que mi aparato» el script cambia
    // `data-tema` antes de que React hidrate, y es a propósito.
    <html
      lang="es"
      style={estilo as React.CSSProperties}
      data-tema={tema.atributo === "sistema" ? "claro" : tema.atributo}
      data-encabezados={encabezadosDe(user?.encabezadosUi).toLowerCase()}
      suppressHydrationWarning
    >
      {tema.atributo === "sistema" ? (
        <head>
          <script dangerouslySetInnerHTML={{ __html: RESOLVER_TEMA_DEL_SISTEMA }} />
        </head>
      ) : null}
      <body>
        <TextosQueCrecen />
        {children}
      </body>
    </html>
  );
}
