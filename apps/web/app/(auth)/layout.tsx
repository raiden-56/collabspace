import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20" />
        <div className="absolute bottom-0 right-0 h-[320px] w-[420px] rounded-full bg-secondary/10 blur-[110px] dark:bg-secondary/20" />
      </div>
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Logo />
        <ThemeToggle compact />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-slide-up">{children}</div>
      </main>
    </div>
  );
}
