import type { Metadata } from "next";
// Paquet `geist` : polices embarquées dans l'app, aucun appel à Google Fonts.
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { themeInitScript } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Portscope",
  description: "Ports ouverts et consommation des processus sur cette machine Windows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning : `data-theme` est posé par le script avant l'hydratation.
    <html lang="fr" className={GeistSans.variable + " " + GeistMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
