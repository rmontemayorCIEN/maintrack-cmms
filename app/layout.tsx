import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { estiloDeApariencia } from "@/lib/apariencia";
import { TextosQueCrecen } from "@/components/textos-que-crecen";

export const metadata: Metadata = {
  title: {
    default: "MainTrack CMMS",
    template: "%s · MainTrack CMMS",
  },
  description:
    "Plataforma SaaS para la programación y control de mantenimiento preventivo, correctivo y predictivo.",
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

  return (
    <html lang="es" style={estilo as React.CSSProperties}>
      <body>
        <TextosQueCrecen />
        {children}
      </body>
    </html>
  );
}
