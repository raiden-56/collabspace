/**
 * Project templates: creating a project from one creates tasks, documents, boards and relationships.
 */

export interface TemplateTask {
  key: string;
  title: string;
  description?: string;
  status?: string;
  priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  labels?: string[];
  /** offset in days from project start */
  startOffsetDays?: number;
  dueOffsetDays?: number;
  parentKey?: string;
  dependsOn?: string[];
}

export interface TemplateDocument {
  title: string;
  icon?: string;
  /** Tiptap JSON content */
  content: Record<string, unknown>;
}

export interface ProjectTemplateDef {
  key: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  color: string;
  icon: string;
  labels: Array<{ name: string; color: string }>;
  columns?: Array<{ name: string; statusKey: string; color: string; isDone?: boolean }>;
  tasks: TemplateTask[];
  documents: TemplateDocument[];
  canvasTemplateKeys: string[];
  milestones?: Array<{ title: string; dueOffsetDays: number }>;
}

const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const ul = (items: string[]) => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });
const checklist = (items: string[]) => ({ type: "taskList", content: items.map((t) => ({ type: "taskItem", attrs: { checked: false }, content: [p(t)] })) });
export const doc = (...content: Record<string, unknown>[]) => ({ type: "doc", content });

export const PROJECT_TEMPLATES: ProjectTemplateDef[] = [
  {
    key: "project.software",
    name: "Software development",
    description: "Backlog, sprint columns, engineering design doc and release checklist.",
    category: "Engineering",
    tags: ["software", "agile", "engineering"],
    color: "#5B8CFF",
    icon: "💻",
    labels: [
      { name: "bug", color: "#EF6464" },
      { name: "feature", color: "#5B8CFF" },
      { name: "tech-debt", color: "#F4B740" },
      { name: "docs", color: "#9B7BFF" },
    ],
    tasks: [
      { key: "t1", title: "Define scope and success metrics", status: "done", priority: "HIGH", dueOffsetDays: 2 },
      { key: "t2", title: "Write engineering design doc", status: "in_progress", priority: "HIGH", labels: ["docs"], dueOffsetDays: 5, dependsOn: ["t1"] },
      { key: "t3", title: "Set up CI pipeline", status: "todo", priority: "MEDIUM", labels: ["tech-debt"], dueOffsetDays: 7 },
      { key: "t4", title: "Implement core API endpoints", status: "todo", priority: "HIGH", labels: ["feature"], dueOffsetDays: 14, dependsOn: ["t2"] },
      { key: "t4a", title: "Authentication endpoints", parentKey: "t4", status: "todo", dueOffsetDays: 10 },
      { key: "t4b", title: "Workspace endpoints", parentKey: "t4", status: "todo", dueOffsetDays: 12 },
      { key: "t5", title: "Build UI components", status: "todo", priority: "MEDIUM", labels: ["feature"], dueOffsetDays: 16, dependsOn: ["t2"] },
      { key: "t6", title: "Write integration tests", status: "backlog", priority: "MEDIUM", dueOffsetDays: 20, dependsOn: ["t4", "t5"] },
      { key: "t7", title: "Release v1.0", status: "backlog", priority: "URGENT", dueOffsetDays: 24, dependsOn: ["t6"] },
    ],
    documents: [
      {
        title: "Engineering design doc",
        icon: "📐",
        content: doc(h(1, "Engineering design doc"), p("Status: Draft"), h(2, "Problem"), p("Describe the problem and why it matters."), h(2, "Goals & non-goals"), ul(["Goal 1", "Goal 2", "Non-goal 1"]), h(2, "Proposed design"), p("Architecture, data model, APIs."), h(2, "Alternatives considered"), p(""), h(2, "Risks & open questions"), checklist(["Open question 1"])),
      },
      {
        title: "Release checklist",
        icon: "🚀",
        content: doc(h(1, "Release checklist"), checklist(["All tests green", "Changelog updated", "Migration plan reviewed", "Rollback plan documented", "Stakeholders notified"])),
      },
    ],
    canvasTemplateKeys: ["canvas.architecture", "canvas.sprint"],
    milestones: [
      { title: "Design approved", dueOffsetDays: 6 },
      { title: "Feature complete", dueOffsetDays: 18 },
      { title: "Release", dueOffsetDays: 24 },
    ],
  },
  {
    key: "project.launch",
    name: "Product launch",
    description: "Cross-functional launch plan with messaging, enablement and go-live tasks.",
    category: "Product",
    tags: ["launch", "go-to-market"],
    color: "#9B7BFF",
    icon: "🚀",
    labels: [
      { name: "marketing", color: "#E06AB5" },
      { name: "sales", color: "#31B887" },
      { name: "product", color: "#5B8CFF" },
    ],
    tasks: [
      { key: "l1", title: "Finalize positioning & messaging", priority: "HIGH", labels: ["marketing"], dueOffsetDays: 5 },
      { key: "l2", title: "Prepare launch blog post", labels: ["marketing"], dueOffsetDays: 10, dependsOn: ["l1"] },
      { key: "l3", title: "Sales enablement deck", labels: ["sales"], dueOffsetDays: 12, dependsOn: ["l1"] },
      { key: "l4", title: "Update pricing page", labels: ["product"], dueOffsetDays: 14 },
      { key: "l5", title: "Beta customer feedback review", labels: ["product"], priority: "MEDIUM", dueOffsetDays: 8 },
      { key: "l6", title: "Go-live", priority: "URGENT", dueOffsetDays: 21, dependsOn: ["l2", "l3", "l4"] },
    ],
    documents: [
      { title: "Launch brief", icon: "📣", content: doc(h(1, "Launch brief"), h(2, "Audience"), p(""), h(2, "Key messages"), ul(["Message 1", "Message 2"]), h(2, "Channels"), ul(["Blog", "Email", "Social"]), h(2, "Timeline"), p("")) },
    ],
    canvasTemplateKeys: ["canvas.roadmap"],
    milestones: [{ title: "Launch day", dueOffsetDays: 21 }],
  },
  {
    key: "project.marketing",
    name: "Marketing campaign",
    description: "Plan, produce and measure a multi-channel campaign.",
    category: "Marketing",
    tags: ["campaign", "content"],
    color: "#E06AB5",
    icon: "📣",
    labels: [
      { name: "content", color: "#9B7BFF" },
      { name: "paid", color: "#F4B740" },
      { name: "analytics", color: "#2FB7D9" },
    ],
    tasks: [
      { key: "m1", title: "Define campaign goals and KPIs", priority: "HIGH", labels: ["analytics"], dueOffsetDays: 3 },
      { key: "m2", title: "Draft content calendar", labels: ["content"], dueOffsetDays: 7, dependsOn: ["m1"] },
      { key: "m3", title: "Produce hero video", labels: ["content"], dueOffsetDays: 14 },
      { key: "m4", title: "Set up paid ads", labels: ["paid"], dueOffsetDays: 15, dependsOn: ["m2"] },
      { key: "m5", title: "Weekly performance review", labels: ["analytics"], dueOffsetDays: 21 },
    ],
    documents: [{ title: "Campaign plan", icon: "🗓️", content: doc(h(1, "Campaign plan"), h(2, "Objectives"), p(""), h(2, "Audience segments"), p(""), h(2, "Budget"), p(""), h(2, "Measurement"), p("")) }],
    canvasTemplateKeys: ["canvas.brainstorm"],
  },
  {
    key: "project.design",
    name: "Design project",
    description: "Discovery, exploration, validation and hand-off.",
    category: "Design",
    tags: ["design", "ux"],
    color: "#2FB7D9",
    icon: "🎨",
    labels: [
      { name: "research", color: "#31B887" },
      { name: "visual", color: "#9B7BFF" },
      { name: "handoff", color: "#5B8CFF" },
    ],
    tasks: [
      { key: "d1", title: "Stakeholder interviews", labels: ["research"], dueOffsetDays: 5 },
      { key: "d2", title: "User journey map", labels: ["research"], dueOffsetDays: 8, dependsOn: ["d1"] },
      { key: "d3", title: "Low-fidelity explorations", labels: ["visual"], dueOffsetDays: 12, dependsOn: ["d2"] },
      { key: "d4", title: "Usability test round 1", labels: ["research"], dueOffsetDays: 16, dependsOn: ["d3"] },
      { key: "d5", title: "High-fidelity designs", labels: ["visual"], dueOffsetDays: 20, dependsOn: ["d4"] },
      { key: "d6", title: "Developer hand-off", labels: ["handoff"], dueOffsetDays: 22, dependsOn: ["d5"] },
    ],
    documents: [{ title: "Design brief", icon: "🎨", content: doc(h(1, "Design brief"), h(2, "Context"), p(""), h(2, "Users"), p(""), h(2, "Success criteria"), ul(["Criterion 1"])) }],
    canvasTemplateKeys: ["canvas.journey", "canvas.research"],
  },
  {
    key: "project.sprint",
    name: "Sprint planning",
    description: "A two-week sprint with planning, review and retro built in.",
    category: "Engineering",
    tags: ["sprint", "scrum"],
    color: "#31B887",
    icon: "🏃",
    labels: [{ name: "story", color: "#5B8CFF" }, { name: "bug", color: "#EF6464" }, { name: "chore", color: "#A0A9BC" }],
    tasks: [
      { key: "s1", title: "Sprint planning meeting", status: "done", dueOffsetDays: 0 },
      { key: "s2", title: "Story: <describe user value>", labels: ["story"], status: "in_progress", dueOffsetDays: 7 },
      { key: "s3", title: "Bug: <describe defect>", labels: ["bug"], priority: "HIGH", dueOffsetDays: 4 },
      { key: "s4", title: "Chore: dependency updates", labels: ["chore"], status: "backlog", dueOffsetDays: 10 },
      { key: "s5", title: "Sprint review", dueOffsetDays: 13 },
      { key: "s6", title: "Sprint retrospective", dueOffsetDays: 14, dependsOn: ["s5"] },
    ],
    documents: [{ title: "Sprint notes", icon: "📝", content: doc(h(1, "Sprint notes"), h(2, "Sprint goal"), p(""), h(2, "Daily notes"), p("")) }],
    canvasTemplateKeys: ["canvas.sprint", "canvas.retro"],
    milestones: [{ title: "Sprint end", dueOffsetDays: 14 }],
  },
  {
    key: "project.research",
    name: "Research project",
    description: "Plan a study, recruit participants, synthesize insights.",
    category: "Research",
    tags: ["research", "study"],
    color: "#F4B740",
    icon: "🔬",
    labels: [{ name: "recruiting", color: "#F4B740" }, { name: "synthesis", color: "#9B7BFF" }],
    tasks: [
      { key: "r1", title: "Write research plan", priority: "HIGH", dueOffsetDays: 3 },
      { key: "r2", title: "Recruit 8 participants", labels: ["recruiting"], dueOffsetDays: 10, dependsOn: ["r1"] },
      { key: "r3", title: "Conduct interviews", dueOffsetDays: 17, dependsOn: ["r2"] },
      { key: "r4", title: "Affinity mapping", labels: ["synthesis"], dueOffsetDays: 20, dependsOn: ["r3"] },
      { key: "r5", title: "Share insights report", labels: ["synthesis"], dueOffsetDays: 24, dependsOn: ["r4"] },
    ],
    documents: [{ title: "Research plan", icon: "🔬", content: doc(h(1, "Research plan"), h(2, "Research questions"), ul(["Question 1"]), h(2, "Method"), p(""), h(2, "Participants"), p(""), h(2, "Timeline"), p("")) }],
    canvasTemplateKeys: ["canvas.research"],
  },
  {
    key: "project.onboarding",
    name: "Team onboarding",
    description: "A 30-day onboarding plan for a new teammate.",
    category: "People",
    tags: ["onboarding", "people"],
    color: "#9B7BFF",
    icon: "👋",
    labels: [{ name: "week-1", color: "#5B8CFF" }, { name: "week-2", color: "#31B887" }, { name: "month-1", color: "#9B7BFF" }],
    tasks: [
      { key: "o1", title: "Accounts and access set up", labels: ["week-1"], dueOffsetDays: 1 },
      { key: "o2", title: "Meet the team", labels: ["week-1"], dueOffsetDays: 3 },
      { key: "o3", title: "Read the team handbook", labels: ["week-1"], dueOffsetDays: 5 },
      { key: "o4", title: "Ship a starter task", labels: ["week-2"], dueOffsetDays: 10, dependsOn: ["o1"] },
      { key: "o5", title: "30-day check-in", labels: ["month-1"], dueOffsetDays: 30 },
    ],
    documents: [{ title: "Team handbook", icon: "📘", content: doc(h(1, "Team handbook"), h(2, "How we work"), p(""), h(2, "Tools"), ul(["CollabSpace", "Source control", "CI"]), h(2, "Rituals"), p("")) }],
    canvasTemplateKeys: [],
  },
];

export interface DocumentTemplateDef {
  key: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  content: Record<string, unknown>;
}

export const DOCUMENT_TEMPLATES: DocumentTemplateDef[] = [
  { key: "doc.meeting-notes", name: "Meeting notes", description: "Agenda, notes, decisions and action items.", category: "Meetings", tags: ["meeting"], icon: "📝", content: doc(h(1, "Meeting notes"), p("Date: "), h(2, "Attendees"), ul(["@name"]), h(2, "Agenda"), ul(["Item 1"]), h(2, "Notes"), p(""), h(2, "Decisions"), ul(["Decision 1"]), h(2, "Action items"), checklist(["Action — owner — due"])) },
  { key: "doc.project-plan", name: "Project plan", description: "Objectives, scope, timeline and risks.", category: "Planning", tags: ["plan"], icon: "🗺️", content: doc(h(1, "Project plan"), h(2, "Objectives"), ul(["Objective"]), h(2, "Scope"), p(""), h(2, "Timeline"), p(""), h(2, "Risks"), p("")) },
  { key: "doc.retro", name: "Sprint retrospective", description: "Structured retro write-up.", category: "Agile", tags: ["retro"], icon: "🔁", content: doc(h(1, "Sprint retrospective"), h(2, "What went well"), ul([""]), h(2, "What could improve"), ul([""]), h(2, "Action items"), checklist([""])) },
  { key: "doc.roadmap", name: "Product roadmap", description: "Themes and quarterly bets.", category: "Strategy", tags: ["roadmap"], icon: "🧭", content: doc(h(1, "Product roadmap"), h(2, "Vision"), p(""), h(2, "Now"), ul([""]), h(2, "Next"), ul([""]), h(2, "Later"), ul([""])) },
  { key: "doc.design-doc", name: "Engineering design doc", description: "Problem, design, alternatives and risks.", category: "Engineering", tags: ["engineering"], icon: "📐", content: doc(h(1, "Engineering design doc"), h(2, "Problem"), p(""), h(2, "Goals"), ul([""]), h(2, "Design"), p(""), h(2, "Alternatives"), p(""), h(2, "Risks"), p("")) },
  { key: "doc.journey", name: "User journey mapping", description: "Narrative companion to a journey canvas.", category: "Research", tags: ["ux"], icon: "🧭", content: doc(h(1, "User journey"), h(2, "Persona"), p(""), h(2, "Stages"), ul(["Awareness", "Consideration", "Onboarding", "Usage"]), h(2, "Opportunities"), p("")) },
  { key: "doc.research-plan", name: "Research planning", description: "Questions, methods, participants.", category: "Research", tags: ["research"], icon: "🔬", content: doc(h(1, "Research plan"), h(2, "Questions"), ul([""]), h(2, "Method"), p(""), h(2, "Participants"), p("")) },
  { key: "doc.weekly-review", name: "Weekly team review", description: "Wins, blockers and priorities for next week.", category: "Rituals", tags: ["weekly"], icon: "📆", content: doc(h(1, "Weekly review"), h(2, "Wins"), ul([""]), h(2, "Blockers"), ul([""]), h(2, "Next week"), checklist([""])) },
  { key: "doc.personal-plan", name: "Personal task planning", description: "Daily and weekly personal planner.", category: "Personal", tags: ["personal"], icon: "✅", content: doc(h(1, "My week"), h(2, "Top 3 priorities"), checklist(["", "", ""]), h(2, "Monday"), checklist([""]), h(2, "Notes"), p("")) },
  { key: "doc.brainstorm", name: "Brainstorming notes", description: "Capture and structure ideas.", category: "Ideation", tags: ["ideas"], icon: "💡", content: doc(h(1, "Brainstorm"), h(2, "Prompt"), p(""), h(2, "Ideas"), ul(["", "", ""]), h(2, "Shortlist"), checklist([""])) },
];
