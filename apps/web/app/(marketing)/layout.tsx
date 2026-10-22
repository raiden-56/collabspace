import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { MarketingNavActions } from "@/components/marketing/nav-actions";

const nav = [
  { href: "/#product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/help", label: "Help" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border/60 glass">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <MarketingNavActions />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-1">
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-text-secondary">Think visually, work collaboratively, and turn every idea into meaningful progress.</p>
          </div>
          <FooterCol title="Product" links={[["/#canvas", "Infinite canvas"], ["/#docs", "Documents"], ["/#tasks", "Projects & tasks"], ["/#meetings", "AI meeting summaries"], ["/app/templates", "Templates"]]} />
          <FooterCol title="Company" links={[["/about", "About"], ["/pricing", "Pricing"], ["/help", "Help center"], ["/api/v1/docs", "API reference"]]} />
          <FooterCol title="Legal" links={[["/privacy", "Privacy policy"], ["/terms", "Terms of service"]]} />
        </div>
        <div className="border-t border-border py-5 text-center text-xs text-text-muted">© {new Date().getFullYear()} CollabSpace. Built for teams who think together.</div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="text-sm text-text-secondary hover:text-text">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
