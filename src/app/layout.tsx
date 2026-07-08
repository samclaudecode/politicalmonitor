import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Political Email Archive",
  description:
    "A searchable archive of political campaign and legislative emails, categorized by policy topic.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">PM</span>
              <span>
                Political<strong>Monitor</strong>
                <small>email archive</small>
              </span>
            </Link>
            <nav className="site-nav">
              <Link href="/">Feed</Link>
              <Link href="/sources">Sources</Link>
              <Link href="/about">About</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container">
            Emails are ingested via Feedbin and ATOM feeds, then categorized by
            policy topic with DeepSeek via OpenRouter.
          </div>
        </footer>
      </body>
    </html>
  );
}
