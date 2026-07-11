import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import { focusParty } from "@/lib/taxonomy";

export const metadata: Metadata = {
  title: "Rebuttal Desk — Reform UK Monitor",
  description:
    "A war-room monitor of Reform UK politicians' emails and original tweets, with AI-drafted rebuttals grounded in your uploaded policy documents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="main">
            <div className="topbar">
              <div className="topbar-title">
                <span aria-hidden>🛡️</span> {focusParty()} Monitor
              </div>
            </div>
            <div className="content">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
