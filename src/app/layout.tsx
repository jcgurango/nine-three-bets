import type { Metadata } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { LiveEvents } from "@/components/LiveEvents";
import { NicknameDialog } from "@/components/Nickname";
import { getUser } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "9-3 Bets",
  description: "Fake-money betting on the Valorant playoffs.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getUser();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Header />
        <main id="app-main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="px-4 py-6 text-center text-xs text-mute">
          Play money only. Credits have no value and can&apos;t be bought or cashed out.
        </footer>
        {user && <LiveEvents userId={user.id} />}
        {user && !user.nickname && <NicknameDialog />}
      </body>
    </html>
  );
}
