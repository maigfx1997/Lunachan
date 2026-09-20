import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppProvider } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "لونا تشان | Luna Chan — تحميل الروايات من كل المواقع",
  description:
    "لونا تشان: اسحبي الرواية كاملة — الغلاف الأصلي والوصف وعناوين الفصول والنص والصور — وحمّليها بصيغ EPUB و PDF و HTML و TXT و Markdown و DOCX و FB2 و JSON. بدون تسجيل دخول.",
  applicationName: "Luna Chan",
  keywords: ["روايات", "تحميل روايات", "EPUB", "PDF", "novel downloader", "wattpad", "novlar", "uranus"],
};

export const viewport: Viewport = {
  themeColor: "#c2437e",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-theme="girl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;800&family=Amiri:wght@400;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <AppProvider>
          <SiteHeader />
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
