import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.SITE_URL || process.env.APP_URL || "https://24benz.ru";
const siteName = "24benz";

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
    siteName,
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    description: "Актуальная карта наличия топлива на АЗС по России",
    inLanguage: "ru-RU",
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang="ru">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {children}
      </body>
    </html>
  );
}
