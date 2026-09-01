import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { estiloDeApariencia } from "@/lib/apariencia";

export const metadata: Metadata = {
  title: {
    default: "MainTrack CMMS",
    template: "%s · MainTrack CMMS",
  },
  description:
    "Plataforma SaaS para la programacion y control de mantenimiento preventivo, correctivo y predictivo.",
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
      <body>{children}</body>
    </html>
  );
}
