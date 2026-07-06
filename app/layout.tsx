import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.SITE_URL || process.env.APP_URL || "https://24benz.ru";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Есть топливо — карта АЗС",
  description: "Актуальные статусы наличия топлива на АЗС",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Есть топливо — карта АЗС",
    description: "Актуальные статусы наличия топлива на АЗС",
    url: siteUrl,
    siteName: "24benz",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
