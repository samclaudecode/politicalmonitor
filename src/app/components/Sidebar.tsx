"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "War Room", icon: "◎", exact: true },
  { href: "/sources", label: "Sources", icon: "📡", exact: false },
  { href: "/documents", label: "Grounding Docs", icon: "📄", exact: false },
  { href: "/about", label: "About", icon: "ⓘ", exact: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">⚡</span>
        <span className="brand-name">Rebuttal&nbsp;Desk</span>
      </Link>
      <nav className="nav">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <span className="nav-ico" aria-hidden>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <span className="pulse-dot" aria-hidden />
        System Active
      </div>
    </aside>
  );
}
