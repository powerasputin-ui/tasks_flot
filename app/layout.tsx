import type { Metadata, Viewport } from "next";
import { DialogHost } from "@/components/ui/Dialog";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "ГШП Оперативка",
  description: "Подготовка оперативной информации: руководители, директора, ЗГД",
  // установка на iPhone: без адресной строки, с понятным названием под значком
  appleWebApp: { capable: true, title: "Оперативка", statusBarStyle: "default" },
};

// телефон: ширина экрана, без автоприближения при вводе; viewport-fit=cover — чтобы учитывать вырезы экрана (safe-area)
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex h-dvh flex-col overflow-hidden">
        <AppShell>{children}</AppShell>
        <DialogHost />
        <PwaRegister />
      </body>
    </html>
  );
}
