import Link from "next/link";
import { ArrowRight, Bot, Boxes, FileText, KanbanSquare, Lock, MessageSquare, Play, Share2, Sparkles, Users, Workflow, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroPreview } from "@/components/marketing/hero-preview";
import { Section, FeatureGrid, SplitFeature, FAQ, Reveal, MockPanel } from "@/components/marketing/sections";

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute -top-48 left-1/2 h-[600px] w-[1000px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px] dark:bg-primary/20" />
          <div className="absolute right-[-10%] top-40 h-[400px] w-[500px] rounded-full bg-secondary/10 blur-[120px] dark:bg-secondary/20" />
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-20 text-center sm:px-6 sm:pt-28">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-secondary shadow-sm">
              <Sparkles className="size-3.5 text-primary" /> Canvas, docs, tasks, chat and meetings — connected
            </span>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Bring Your Team&apos;s Best Ideas Together.</h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-xl text-balance text-lg text-text-secondary">Think visually, work collaboratively, and turn every idea into meaningful progress.</p>
          </Reveal>
          <Reveal delay={0.15} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/register">
                Start collaborating <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#product">
                <Play /> Explore the workspace
              </Link>
            </Button>
          </Reveal>
          <HeroPreview />
        </div>
      </section>

      {/* Product overview */}
      <Section id="product" eyebrow="One connected workspace" title="Everything your team makes, in one place" description="Canvas objects, documents, tasks, meetings and discussions reference one another, so context never gets lost between tools.">
        <FeatureGrid
          items={[
            { icon: <Boxes />, title: "Infinite canvas", description: "Sticky notes, shapes, connectors, frames and freehand drawing on a limitless board that stays smooth with thousands of objects." },
            { icon: <FileText />, title: "Collaborative documents", description: "Rich-text docs with live cursors, inline comments, slash commands, tables, checklists and version history." },
            { icon: <KanbanSquare />, title: "Projects & tasks", description: "Kanban, list, calendar and timeline views with dependencies, labels, assignees and bulk actions." },
            { icon: <MessageSquare />, title: "Team chat", description: "Channels, direct messages and threads attached to the work they are about." },
            { icon: <Bot />, title: "AI meeting assistant", description: "Summaries, decisions and action-item drafts you review before anything becomes a task." },
            { icon: <Users />, title: "Presence everywhere", description: "See who is viewing, editing and where their cursor is — in canvases, docs and boards." },
          ]}
        />
      </Section>

      <SplitFeature
        id="canvas"
        eyebrow="Infinite canvas"
        title="Brainstorm without boundaries"
        description="Pan and zoom through an effectively unbounded space. Every object is real and editable — not a screenshot — and every change syncs instantly to teammates."
        bullets={["Sticky notes, text, shapes, arrows, frames, images, embeds and diagram nodes", "Snap-to-grid, alignment guides, grouping, layering and auto-arrange", "Connectors stay attached when shapes move or resize", "Templates for retros, journeys, flowcharts, roadmaps and more"]}
        visual={
          <MockPanel title="Retrospective · 4 collaborators">
            <div className="grid grid-cols-3 gap-2">
              {["Went well", "Could improve", "Actions"].map((c, i) => (
                <div key={c} className="rounded-lg bg-surface-2 p-2">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{c}</p>
                  {[0, 1].map((n) => (
                    <div key={n} className="mb-2 h-14 rounded-md p-2 text-[11px] text-[#1F2430] shadow-sm" style={{ background: ["#B5EAD7", "#FFB8A2", "#C7CEEA"][i] }}>
                      {["Shipped the sync service", "Fewer late reviews", "Pair on canvas perf"][i]}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </MockPanel>
        }
      />

      <SplitFeature
        id="docs"
        eyebrow="Real-time documents"
        title="Write together, without stepping on each other"
        description="Documents are powered by conflict-free collaborative editing. Two people can type in the same paragraph and both see a consistent result — even after a brief disconnection."
        bullets={["Headings, lists, checklists, tables, code blocks and embeds", "Inline comments, @mentions and threaded discussions", "Automatic checkpoints plus named restore points", "Convert a checklist item into a tracked task"]}
        reverse
        visual={
          <MockPanel title="Engineering design doc · 2 editing">
            <div className="space-y-2 text-sm">
              <div className="h-5 w-2/3 rounded bg-surface-3" />
              <div className="h-3 w-full rounded bg-surface-2" />
              <div className="h-3 w-11/12 rounded bg-surface-2" />
              <div className="relative h-3 w-4/5 rounded bg-surface-2">
                <span className="absolute -top-5 left-1/3 rounded bg-[#31B887] px-1.5 py-0.5 text-[10px] font-semibold text-white">Theo</span>
                <span className="absolute left-1/3 top-0 h-3 w-0.5 bg-[#31B887]" />
              </div>
              <div className="h-3 w-full rounded bg-surface-2" />
              <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft p-2 text-[11px]">
                <span className="font-semibold">Maya:</span> Should this be a background job? <span className="text-text-muted">· 2 replies</span>
              </div>
            </div>
          </MockPanel>
        }
      />

      <SplitFeature
        id="tasks"
        eyebrow="Projects & tasks"
        title="From idea to done, with context attached"
        description="Turn sticky notes, checklist items, comments and meeting action items into tasks that keep a link back to where they came from."
        bullets={["Kanban, list, calendar, timeline and My Tasks views", "Dependencies with cycle detection and blocked indicators", "Configurable board columns and bulk actions", "Project dashboards calculated from real records"]}
        visual={
          <MockPanel title="Board · Launch">
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {[["To do", 3], ["In progress", 2], ["Done", 5]].map(([c, n]) => (
                <div key={String(c)} className="rounded-lg bg-surface-2 p-2">
                  <p className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    {c} <span>{n}</span>
                  </p>
                  {[0, 1].map((i) => (
                    <div key={i} className="mb-2 rounded-md border border-border bg-surface p-2 shadow-sm">
                      <div className="h-2.5 w-4/5 rounded bg-surface-3" />
                      <div className="mt-2 flex items-center justify-between">
                        <span className="rounded bg-primary-soft px-1 text-[9px] text-primary">LNCH-{i + 4}</span>
                        <span className="size-4 rounded-full bg-secondary" />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </MockPanel>
        }
      />

      <SplitFeature
        id="meetings"
        eyebrow="AI meeting summaries"
        title="Meetings that end with decisions, not just notes"
        description="Paste or upload a transcript and let the assistant draft a recap, decisions, open questions and action items — each linked to the excerpt that supports it. You review and confirm before anything is created."
        bullets={["Agenda, collaborative notes, decision log and action items in one place", "Suggested owners and deadlines only when the source supports them", "Regenerate, edit or discard — AI never silently changes your records", "Bring your own model provider; keys stay on the server"]}
        reverse
        visual={
          <MockPanel title="Weekly sync · AI recap">
            <div className="space-y-3 text-[12px]">
              <p className="rounded-md bg-surface-2 p-2 text-text-secondary">Team agreed to ship canvas and docs first. Comments move to the following sprint. Storage decision made.</p>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Action items (draft)</p>
                {["Set up S3 bucket and signed URLs — Jordan — Fri", "Share comments design doc — Sam — Wed"].map((a) => (
                  <div key={a} className="mb-1.5 flex items-center justify-between rounded-md border border-border p-2">
                    <span>{a}</span>
                    <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">Review</span>
                  </div>
                ))}
              </div>
            </div>
          </MockPanel>
        }
      />

      <Section eyebrow="Collaboration & presence" title="Always know who is here and what changed" description="Live cursors, avatars and selections appear wherever your team works. Activity feeds and notifications keep everyone aligned without noise.">
        <FeatureGrid
          items={[
            { icon: <Users />, title: "Live presence", description: "Avatars, cursors and selections on canvases and documents, plus who is viewing each board or meeting." },
            { icon: <Zap />, title: "Offline-aware", description: "Keep editing canvases and documents through a flaky connection; pending changes sync when you are back online." },
            { icon: <Workflow />, title: "Templates & automation", description: "Start from proven templates and let simple rules notify people, suggest status changes or prepare summaries." },
          ]}
        />
      </Section>

      <Section id="security" eyebrow="Security & permissions" title="Access control at every level" description="Workspace roles, project membership, resource-level grants and expiring share links — enforced on the server, never just hidden in the UI.">
        <FeatureGrid
          items={[
            { icon: <Lock />, title: "Least privilege by default", description: "Owners, admins, members and guests. Private projects and resources are invisible until shared." },
            { icon: <Share2 />, title: "Share links you control", description: "Unguessable tokens, optional sign-in requirement, expiration and one-click revocation." },
            { icon: <Bot />, title: "AI with boundaries", description: "The assistant only sees what you can see and asks before creating or changing records. Every AI action is logged." },
          ]}
        />
      </Section>

      <Section eyebrow="FAQ" title="Frequently asked questions">
        <FAQ
          items={[
            { q: "How does real-time collaboration work?", a: "Canvases and documents use conflict-free replicated data types (Yjs) synchronized through an authenticated WebSocket service. Every participant's edits merge automatically, and presence is shared through the same channel." },
            { q: "Does it work offline?", a: "Supported editors (canvas and documents) keep a local copy and queue your changes while you are offline; they synchronize when connectivity returns. Operations that need the server — like inviting people or creating tasks — require a connection, and the app tells you when that is the case." },
            { q: "What does the AI assistant send to a model provider?", a: "Only the content you explicitly include when you run an AI action — for example a meeting transcript when you ask for a summary. Nothing is sent automatically, API keys live on the server, and you can run the built-in offline provider instead." },
            { q: "Can I self-host?", a: "Yes. CollabSpace ships with a Docker Compose setup for PostgreSQL, Redis and S3-compatible storage, plus deployment documentation for the API, sync service and web app." },
            { q: "How is access controlled?", a: "Roles at the workspace level, membership at the project level, explicit grants per resource and share links with expiry. Every request — REST or WebSocket — is authorized against the database." },
          ]}
        />
      </Section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary to-secondary p-10 text-center text-white shadow-lg sm:p-16">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Ready to think together?</h2>
            <p className="mx-auto mt-3 max-w-lg text-balance text-white/85">Create a workspace, invite your team and start from a template in under two minutes.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" variant="secondary" className="border-0 bg-white text-primary hover:bg-white/90">
                <Link href="/register">
                  Start collaborating <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
