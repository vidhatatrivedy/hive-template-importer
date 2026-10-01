import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Backdrop } from "@/app/ui/backdrop";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Templates",
  description: "Import a Spectora template and check that nothing was lost.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <Backdrop>{children}</Backdrop>
      </body>
    </html>
  );
}
