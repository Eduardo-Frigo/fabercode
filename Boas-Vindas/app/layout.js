import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

const welcomeName = process.env.NEXT_PUBLIC_WELCOME_NAME?.trim() || "Eduardo";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: `Olá, ${welcomeName} | Faber Code`,
  description: "Seja bem-vindo ao Faber Code, onde ideias ganham clareza, estrutura e espaço para evoluir.",
  applicationName: "Faber Code",
  keywords: ["Faber Code", "boas-vindas", "desenvolvimento", "planejamento de produto"],
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Faber Code",
    title: `Olá, ${welcomeName} | Faber Code`,
    description: "Ideias claras. Projetos bem estruturados. Um novo ponto de partida.",
    images: [
      {
        url: "/faber-code-logo.png",
        width: 4500,
        height: 1093,
        alt: "Logo Faber Code",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `Olá, ${welcomeName} | Faber Code`,
    description: "Ideias claras. Projetos bem estruturados. Um novo ponto de partida.",
    images: ["/faber-code-logo.png"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
