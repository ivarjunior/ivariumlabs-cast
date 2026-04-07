import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IvariumLabs",
  description: "Interne workspace en tooling voor IvariumLabs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
