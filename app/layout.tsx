import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "ГШП Оперативка",
  description: "Подготовка оперативной информации: подразделения, кураторы, руководство",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="flex h-full flex-col overflow-hidden">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
