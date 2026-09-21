import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "ГШП Оперативка",
  description: "Подготовка оперативной информации: руководители, кураторы, руководство",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex h-full flex-col overflow-hidden">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
