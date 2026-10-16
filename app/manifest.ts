import type { MetadataRoute } from "next";

// Установка на телефон и компьютер («на экран Домой»): открывается без адресной строки, ярлыки на «Мой день» и «Трекер».
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ГШП Оперативка",
    short_name: "Оперативка",
    description: "Оперативная информация: руководители, директора, ЗГД",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Мой день", url: "/today" },
      { name: "Трекер", url: "/tracker" },
    ],
  };
}
