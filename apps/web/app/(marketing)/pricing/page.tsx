import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, Reveal, FAQ } from "@/components/marketing/sections";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pricing" };

/**
 * Pricing is configuration, not code: edit this table to change plans. No fake customer logos or
 * usage statistics are shown anywhere on the marketing site.
 */
const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "For individuals and small teams getting started.",
    cta: { label: "Start for free", href: "/register" },
    features: ["Up to 5 members", "3 projects", "Unlimited canvases & documents", "Real-time collaboration", "7-day version history", "Community support"],
  },
  {
    name: "Team",
    price: "$9",
    period: "per member / month",
    description: "For teams that need more structure and history.",
    highlight: true,
    cta: { label: "Start a Team trial", href: "/register?plan=team" },
    features: ["Unlimited members & projects", "AI meeting summaries & assistant", "Workflow automation", "90-day version history", "Guest access & share-link controls", "Priority email support"],
  },
  {
    name: "Business",
    price: "Custom",
    period: "annual billing",
    description: "For organizations with security and compliance needs.",
    cta: { label: "Talk to us", href: "/help#contact" },
    features: ["Everything in Team", "SSO & SCIM (via configured identity provider)", "Audit log export", "Unlimited version history", "Custom data retention", "Dedicated support"],
  },
];

export default function PricingPage() {
  return (
    <>
      <Section eyebrow="Pricing" title="Simple pricing that scales with your team" description="Start free. Upgrade when your team needs AI assistance, automation and longer history.">
        <div className="grid gap-5 lg:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.06}>
              <div className={cn("relative flex h-full flex-col rounded-2xl border bg-surface p-7 shadow-sm", p.highlight ? "border-primary shadow-md ring-1 ring-primary/30" : "border-border")}>
                {p.highlight ? <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-white">Most popular</span> : null}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-text-secondary">{p.description}</p>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight">{p.price}</span>
                  <span className="text-sm text-text-muted">{p.period}</span>
                </div>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8" variant={p.highlight ? "default" : "outline"}>
                  <Link href={p.cta.href}>{p.cta.label}</Link>
                </Button>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
      <Section eyebrow="Questions" title="Pricing FAQ" className="pt-0">
        <FAQ
          items={[
            { q: "Is there a free trial for paid plans?", a: "Yes — Team features can be trialed for 14 days without a credit card." },
            { q: "How are members counted?", a: "Anyone with a workspace role of member, admin or owner. Guests with limited access are free." },
            { q: "Can I self-host instead?", a: "CollabSpace is deployable on your own infrastructure. The repository includes Docker Compose configuration and deployment documentation." },
            { q: "Which AI models are used?", a: "You configure the provider and model on your server. The offline mock provider is included for development and evaluation." },
          ]}
        />
      </Section>
    </>
  );
}
