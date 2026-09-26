import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReachSched",
  description: "Email scheduling infrastructure.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-[#262626] text-gray-900">
        <div className="flex-1 flex flex-col h-screen overflow-hidden p-2 sm:p-4">
          {children}
        </div>
      </body>
    </html>
  );
}
