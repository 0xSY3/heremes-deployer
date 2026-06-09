import type { Metadata } from "next";
import { Chakra_Petch, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Matches zynd.ai: Chakra Petch (700, uppercase) for display, Space Grotesk for
// body, JetBrains Mono for meta/code. Mirrors the main dashboard's font stack.
const chakra = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZYND Hermes Deployer",
  description: "One-click private Hermes agent deployment by ZYND.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${chakra.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
