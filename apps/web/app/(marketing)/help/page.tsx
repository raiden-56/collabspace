import Link from "next/link";
import { Section, FAQ } from "@/components/marketing/sections";
import { Card } from "@/components/ui/skeleton";
import { Keyboard, LifeBuoy, Lock, Sparkles, Wifi, BookOpen } from "lucide-react";

export const metadata = { title: "Help center" };

const topics = [
  { icon: <BookOpen />, title: "Getting started", items: ["Create a workspace and invite teammates from Members.", "Start from a template in Templates, or create a blank canvas or document.", "Use the sidebar to switch between projects, canvases, documents, tasks, meetings and chat."] },
  { icon: <Keyboard />, title: "Keyboard shortcuts", items: ["Ctrl/⌘ + K opens the command palette.", "V select, H hand, N sticky note, T text, R rectangle, O ellipse, D diamond, L line, A arrow, P pen, F frame on the canvas.", "Ctrl/⌘ + Z / Shift + Z undo and redo. Delete removes the selection. Ctrl/⌘ + D duplicates.", "Press ? anywhere in the app to see the full reference."] },
  { icon: <Wifi />, title: "Offline & sync", items: ["Canvases and documents keep a local copy; edits made offline are queued and synchronized when you reconnect.", "The connection indicator in the top bar shows live, reconnecting or offline.", "Creating tasks, inviting people and other server operations require a connection."] },
  { icon: <Lock />, title: "Sharing & permissions", items: ["Workspace roles: owner, admin, member, guest.", "Make a resource private and grant specific people viewer, commenter or editor access.", "Share links can require sign-in, expire automatically and be revoked at any time."] },
  { icon: <Sparkles />, title: "AI assistant", items: ["Paste or upload a transcript in a meeting, then click Summarize. You will be asked to confirm what is sent to the configured provider.", "Action items are drafts until you review and convert them into tasks.", "The assistant only uses content you are allowed to see and asks before creating records."] },
  { icon: <LifeBuoy />, title: "Troubleshooting", items: ["If a canvas shows “reconnecting”, check your network; your edits are safe locally.", "Not receiving emails? Ask your administrator to verify the SMTP configuration.", "Administrators can check service health under Admin → System."] },
];

export default function HelpPage() {
  return (
    <>
      <Section eyebrow="Help center" title="Guides, shortcuts and answers" description="Everything you need to get the most out of CollabSpace.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {topics.map((t) => (
            <Card key={t.title} className="p-6">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-5">{t.icon}</div>
              <h3 className="font-semibold">{t.title}</h3>
              <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                {t.items.map((i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-text-muted" />
                    {i}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>
      <Section id="contact" eyebrow="Contact" title="Still need help?" className="pt-0">
        <FAQ
          items={[
            { q: "How do I report a problem?", a: "Use the feedback option in the user menu inside the app, or contact your workspace administrator. For self-hosted deployments, check the API and sync service logs." },
            { q: "Where is the API documented?", a: "Interactive OpenAPI documentation is served by the API at /api/v1/docs." },
          ]}
        />
        <p className="mt-6 text-center text-sm text-text-secondary">
          Looking for legal information? Read our <Link href="/privacy" className="text-primary underline">privacy policy</Link> and <Link href="/terms" className="text-primary underline">terms of service</Link>.
        </p>
      </Section>
    </>
  );
}
