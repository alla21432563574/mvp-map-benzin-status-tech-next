import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "24benz — карта АЗС",
    short_name: "24benz",
    description: "Актуальные статусы наличия топлива на АЗС",
    start_url: "https://24benz.ru",
    scope: "https://24benz.ru",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#16a34a",
    lang: "ru",
  };
}
