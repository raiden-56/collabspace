"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Section({ id, eyebrow, title, description, children, className, align = "center" }: { id?: string; eyebrow?: string; title: string; description?: string; children?: React.ReactNode; className?: string; align?: "center" | "left" }) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6", className)}>
      <Reveal className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
        {eyebrow ? <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p> : null}
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {description ? <p className="mt-4 text-balance text-base text-text-secondary sm:text-lg">{description}</p> : null}
      </Reveal>
      {children ? <div className="mt-12">{children}</div> : null}
    </section>
  );
}

export function FeatureGrid({ items }: { items: Array<{ icon: React.ReactNode; title: string; description: string }> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f, i) => (
        <Reveal key={f.title} delay={i * 0.05}>
          <div className="h-full rounded-xl border border-border bg-surface p-6 shadow-sm transition-shadow hover:shadow-md">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-5">{f.icon}</div>
            <h3 className="text-base font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{f.description}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

export function SplitFeature({ id, eyebrow, title, description, bullets, visual, reverse }: { id?: string; eyebrow: string; title: string; description: string; bullets: string[]; visual: React.ReactNode; reverse?: boolean }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6">
      <div className={cn("grid items-center gap-10 lg:grid-cols-2", reverse && "lg:[&>*:first-child]:order-2")}>
        <Reveal>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-4 text-text-secondary">{description}</p>
          <ul className="mt-6 space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}>{visual}</Reveal>
      </div>
    </section>
  );
}

export function FAQ({ items }: { items: Array<{ q: string; a: string }> }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto max-w-3xl divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map((it, i) => (
        <div key={it.q}>
          <button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {it.q}
            <ChevronDown className={cn("size-4 shrink-0 text-text-muted transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i ? <div className="px-5 pb-5 text-sm leading-relaxed text-text-secondary">{it.a}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** Small illustrative panels used in split features */
export function MockPanel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface shadow-md", className)}>
      <div className="flex h-9 items-center border-b border-border bg-surface-2 px-3 text-[11px] font-medium text-text-secondary">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}
