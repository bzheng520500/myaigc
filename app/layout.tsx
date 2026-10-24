import type { Metadata } from "next";
import { fontSans, fontSerif } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI影视工坊",
  description: "AI 影视制作学习社区——中文教程、案例与实战交流",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${fontSans.variable} ${fontSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--fg)] font-sans">
        {children}
      </body>
    </html>
  );
}
