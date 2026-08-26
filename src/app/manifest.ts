import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "مدیریت استراحت کال‌سنتر",
    short_name: "استراحت",
    description: "مدیریت هوشمند زمان کار و استراحت کارکنان کال‌سنتر",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#6366f1",
    dir: "rtl",
    lang: "fa",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
