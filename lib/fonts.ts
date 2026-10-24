import { Inter, Noto_Serif_SC } from "next/font/google";

/** 正文无衬线字体：Inter + 系统黑体栈（栈定义见 app/globals.css @theme --font-sans） */
export const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

/** 标题衬线字体：Noto Serif SC（思源宋体） */
export const fontSerif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif",
});
