"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCOUNT_NAV_ITEMS } from "@/components/nav-items";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div>
    <nav className="settings-tabs">
      {ACCOUNT_NAV_ITEMS.map((item) => <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}>{item.label}</Link>)}
    </nav>
    {children}
  </div>;
}
