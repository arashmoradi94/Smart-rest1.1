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
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "شروع شیفت",
        short_name: "شیفت",
        description: "رفتن مستقیم به داشبورد برای شروع شیفت",
        url: "/dashboard",
      },
      {
        name: "پنل مدیریت",
        short_name: "مدیریت",
        description: "وضعیت زنده‌ی تیم",
        url: "/admin",
      },
    ],
  };
}
