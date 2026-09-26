import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Navbar from "../components/Navbar";
import { ThemeProvider } from "../components/ThemeProvider";
import { isAdminAuthenticated } from "@/lib/security/server-auth";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noah Sterenberg",
  description: "Personal Website and Server Dashboard",
  appleWebApp: { capable: true, title: "Noah Stuf", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
    { media: "(prefers-color-scheme: light)", color: "#f0f2f5" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isAdmin = await isAdminAuthenticated();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}` }} />
      </head>
      <body>
        <ThemeProvider>
          <AnalyticsTracker />
          <ServiceWorkerRegistrar />
          <Navbar isAdmin={isAdmin} />
          <main className="container">
            {children}
          </main>
          <footer style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontSize: '0.875rem', marginTop: 'auto' }}>
            <p>{new Date().getFullYear()} Noah Sterenberg. Its alive.
              <Link href="/login" style={{ opacity: 0, paddingLeft: '0.5rem', cursor: 'pointer' }}>.</Link>
            </p>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
