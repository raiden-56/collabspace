import { Section, FeatureGrid } from "@/components/marketing/sections";
import { Compass, HeartHandshake, ShieldCheck, Sparkles } from "lucide-react";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <Section eyebrow="About CollabSpace" title="Built for teams who think together" description="CollabSpace exists because great ideas rarely arrive in a single tool. They start as a sketch, become a plan, get discussed, and turn into work. We built one connected space for the whole journey.">
        <div className="mx-auto max-w-3xl space-y-5 text-text-secondary">
          <p>Most collaboration stacks scatter context: a whiteboard here, a doc there, tasks in a third tool and decisions buried in chat. Every hand-off between them loses something. CollabSpace keeps canvas objects, documents, tasks, meetings and discussions linked so the why behind the work stays attached to the work itself.</p>
          <p>We care about real-time collaboration that actually works — conflict-free editing, honest offline behavior and presence that respects privacy. And we believe AI should organize and summarize, not quietly rewrite your records: every generated action item waits for a human to approve it.</p>
        </div>
      </Section>
      <Section eyebrow="Principles" title="What we optimize for" className="pt-0">
        <FeatureGrid
          items={[
            { icon: <Compass />, title: "Everything is connected", description: "Notes become tasks, tasks link to docs, meetings produce decisions — with references preserved." },
            { icon: <Sparkles />, title: "Real-time by default", description: "Multiple people can work in the same space at the same time, and it should feel effortless." },
            { icon: <ShieldCheck />, title: "Secure collaboration", description: "Access is enforced on the server at every level, from workspace roles to expiring share links." },
            { icon: <HeartHandshake />, title: "Honest software", description: "We don't fake offline support, integrations or AI capabilities. If something needs configuration, we say so." },
          ]}
        />
      </Section>
    </>
  );
}
