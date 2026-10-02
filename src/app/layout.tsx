import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { UnsavedGuardProvider } from "@/app/unsaved-guard";
import { TemplateSidebar } from "@/app/sidebar/template-sidebar";
import { parseTheme, THEME_COOKIE, themeAttribute } from "@/app/theme";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={themeAttribute(theme)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <UnsavedGuardProvider>
          <Backdrop>
            <TemplateSidebar theme={theme} />
            <div className="h-full pl-14">{children}</div>
          </Backdrop>
        </UnsavedGuardProvider>
      </body>
    </html>
  );
}
