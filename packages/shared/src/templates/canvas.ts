import type { CanvasObjectInput, CanvasSnapshot } from "../canvas";
import { CanvasMeta, STICKY_COLORS } from "../canvas";

/**
 * Built-in canvas templates. Each generator produces real editable objects (not images).
 * IDs are deterministic per template instantiation via a prefix so connectors can reference shapes.
 */

export interface CanvasTemplateDef {
  key: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  build: (idp: (s: string) => string) => CanvasObjectInput[];
}

const frame = (id: string, title: string, x: number, y: number, w: number, h: number, fill = "#EEF1F8"): CanvasObjectInput => ({
  id, type: "frame", title, x, y, width: w, height: h, fill, stroke: "#CBD2E1", zIndex: -10,
});
const sticky = (id: string, text: string, x: number, y: number, color: string = STICKY_COLORS[0], parentId: string | null = null): CanvasObjectInput => ({
  id, type: "sticky", text, x, y, width: 180, height: 120, color, parentId, zIndex: 10,
});
const text = (id: string, t: string, x: number, y: number, fontSize = 24, w = 600): CanvasObjectInput => ({
  id, type: "text", text: t, x, y, width: w, height: fontSize * 1.6, fontSize, fontWeight: "bold", textAlign: "left", zIndex: 5,
});
const node = (id: string, label: string, x: number, y: number, shape: "rounded" | "diamond" | "ellipse" | "rect" | "parallelogram" | "cylinder" = "rounded", fill = "#FFFFFF"): CanvasObjectInput => ({
  id, type: "node", text: label, x, y, width: 180, height: 72, nodeShape: shape, fill, stroke: "#5B8CFF", zIndex: 20,
});
const connector = (id: string, from: string, to: string, label = "", fromSide: "top" | "right" | "bottom" | "left" = "right", toSide: "top" | "right" | "bottom" | "left" = "left"): CanvasObjectInput => ({
  id, type: "connector", x: 0, y: 0, from: { objectId: from, side: fromSide }, to: { objectId: to, side: toSide }, label, arrowEnd: true, stroke: "#5B8CFF", zIndex: 15,
});
const rect = (id: string, x: number, y: number, w: number, h: number, fill: string, label = ""): CanvasObjectInput => ({
  id, type: "rect", x, y, width: w, height: h, fill, stroke: "#CBD2E1", text: label, textColor: "#1F2430", zIndex: 1,
});

function columns(idp: (s: string) => string, titles: string[], colors: string[], x0 = 80, y0 = 120, w = 320, h = 720, samples: string[][] = []): CanvasObjectInput[] {
  const out: CanvasObjectInput[] = [];
  titles.forEach((t, i) => {
    const fid = idp(`col${i}`);
    out.push(frame(fid, t, x0 + i * (w + 40), y0, w, h, colors[i % colors.length]));
    (samples[i] ?? []).forEach((s, j) => out.push(sticky(idp(`s${i}_${j}`), s, x0 + i * (w + 40) + 30 + (j % 2) * 150 * 0, y0 + 80 + j * 140, STICKY_COLORS[(i + j) % STICKY_COLORS.length], fid)));
  });
  return out;
}

export const CANVAS_TEMPLATES: CanvasTemplateDef[] = [
  {
    key: "canvas.brainstorm",
    name: "Brainstorming",
    description: "Capture ideas fast with themed sticky zones and a parking lot.",
    category: "Ideation",
    tags: ["ideas", "sticky notes", "workshop"],
    build: (idp) => [
      text(idp("title"), "Brainstorm: <topic>", 80, 40, 32),
      ...columns(idp, ["Ideas", "Questions", "Build on this", "Parking lot"], ["#EEF1F8", "#FDF3E7", "#E9F7F1", "#F3EEF9"], 80, 120, 320, 620, [["Example idea — double-click to edit"], [], [], []]),
    ],
  },
  {
    key: "canvas.mindmap",
    name: "Mind map",
    description: "A central topic with branches you can extend with connectors.",
    category: "Ideation",
    tags: ["mind map", "structure"],
    build: (idp) => {
      const out: CanvasObjectInput[] = [node(idp("center"), "Central topic", 600, 400, "ellipse", "#E3EAFF")];
      const branches = ["Branch A", "Branch B", "Branch C", "Branch D"];
      const pos = [[200, 200], [1000, 200], [200, 600], [1000, 600]] as const;
      branches.forEach((b, i) => {
        const [x, y] = pos[i]!;
        out.push(node(idp(`b${i}`), b, x, y, "rounded", "#FFFFFF"));
        out.push(connector(idp(`c${i}`), idp("center"), idp(`b${i}`), "", i % 2 === 0 ? "left" : "right", i % 2 === 0 ? "right" : "left"));
        out.push(sticky(idp(`l${i}`), "Sub-idea", x + (i % 2 === 0 ? -220 : 220), y - 20, STICKY_COLORS[i % STICKY_COLORS.length]));
        out.push({ id: idp(`cl${i}`), type: "connector", x: 0, y: 0, from: { objectId: idp(`b${i}`), side: i % 2 === 0 ? "left" : "right" }, to: { objectId: idp(`l${i}`), side: i % 2 === 0 ? "right" : "left" }, arrowEnd: false, stroke: "#A0A9BC", zIndex: 15 });
      });
      return out;
    },
  },
  {
    key: "canvas.journey",
    name: "User journey map",
    description: "Stages, actions, thoughts, emotions and opportunities in a grid.",
    category: "Research",
    tags: ["ux", "journey", "customer"],
    build: (idp) => {
      const stages = ["Awareness", "Consideration", "Onboarding", "Usage", "Advocacy"];
      const rows = ["Actions", "Thoughts", "Pain points", "Opportunities"];
      const out: CanvasObjectInput[] = [text(idp("title"), "User journey: <persona>", 80, 40, 32)];
      stages.forEach((s, i) => out.push(rect(idp(`stage${i}`), 300 + i * 260, 120, 240, 60, "#E3EAFF", s)));
      rows.forEach((r, j) => {
        out.push(rect(idp(`row${j}`), 80, 200 + j * 200, 200, 180, "#EEF1F8", r));
        stages.forEach((_, i) => out.push(sticky(idp(`cell${i}_${j}`), "", 330 + i * 260, 230 + j * 200, STICKY_COLORS[j % STICKY_COLORS.length])));
      });
      return out;
    },
  },
  {
    key: "canvas.flowchart",
    name: "Flowchart",
    description: "Start, decisions and process steps with directional connectors.",
    category: "Diagrams",
    tags: ["process", "flow", "decision"],
    build: (idp) => [
      node(idp("start"), "Start", 500, 80, "ellipse", "#E9F7F1"),
      node(idp("step1"), "Collect input", 500, 220, "rounded"),
      node(idp("dec"), "Valid?", 500, 360, "diamond", "#FDF3E7"),
      node(idp("step2"), "Process request", 500, 520, "rounded"),
      node(idp("fix"), "Show error", 860, 360, "rounded", "#FDECEC"),
      node(idp("end"), "End", 500, 660, "ellipse", "#E9F7F1"),
      connector(idp("c1"), idp("start"), idp("step1"), "", "bottom", "top"),
      connector(idp("c2"), idp("step1"), idp("dec"), "", "bottom", "top"),
      connector(idp("c3"), idp("dec"), idp("step2"), "Yes", "bottom", "top"),
      connector(idp("c4"), idp("dec"), idp("fix"), "No", "right", "left"),
      connector(idp("c5"), idp("fix"), idp("step1"), "Retry", "top", "right"),
      connector(idp("c6"), idp("step2"), idp("end"), "", "bottom", "top"),
    ],
  },
  {
    key: "canvas.architecture",
    name: "System architecture",
    description: "Clients, services, queues and data stores with labeled links.",
    category: "Diagrams",
    tags: ["architecture", "system", "engineering"],
    build: (idp) => [
      frame(idp("edge"), "Edge", 60, 80, 300, 500, "#EEF1F8"),
      frame(idp("svc"), "Services", 420, 80, 560, 500, "#E9F7F1"),
      frame(idp("data"), "Data", 1040, 80, 300, 500, "#F3EEF9"),
      node(idp("web"), "Web app", 120, 160, "rounded", "#FFFFFF"),
      node(idp("mobile"), "Mobile app", 120, 320, "rounded", "#FFFFFF"),
      node(idp("api"), "REST API", 480, 160, "rounded"),
      node(idp("ws"), "Realtime service", 480, 320, "rounded"),
      node(idp("worker"), "Job worker", 740, 240, "rounded"),
      node(idp("pg"), "PostgreSQL", 1100, 160, "cylinder", "#FFFFFF"),
      node(idp("redis"), "Redis", 1100, 320, "cylinder", "#FFFFFF"),
      node(idp("s3"), "Object storage", 1100, 460, "cylinder", "#FFFFFF"),
      connector(idp("c1"), idp("web"), idp("api"), "HTTPS"),
      connector(idp("c2"), idp("web"), idp("ws"), "WSS"),
      connector(idp("c3"), idp("mobile"), idp("api"), "HTTPS"),
      connector(idp("c4"), idp("api"), idp("pg"), "SQL"),
      connector(idp("c5"), idp("ws"), idp("redis"), "pub/sub"),
      connector(idp("c6"), idp("api"), idp("worker"), "enqueue"),
      connector(idp("c7"), idp("worker"), idp("s3"), "upload"),
    ],
  },
  {
    key: "canvas.sprint",
    name: "Sprint planning",
    description: "Goal, capacity and a candidate backlog to pull into the sprint.",
    category: "Agile",
    tags: ["sprint", "planning", "scrum"],
    build: (idp) => [
      text(idp("title"), "Sprint <n> planning", 80, 40, 32),
      sticky(idp("goal"), "Sprint goal: …", 80, 110, "#C7CEEA"),
      sticky(idp("cap"), "Capacity: … points", 280, 110, "#D6F0FF"),
      ...columns(idp, ["Candidate backlog", "Committed", "Stretch", "Risks & dependencies"], ["#EEF1F8", "#E9F7F1", "#FDF3E7", "#FDECEC"], 80, 260, 320, 600),
    ],
  },
  {
    key: "canvas.retro",
    name: "Retrospective",
    description: "What went well, what to improve, and concrete actions.",
    category: "Agile",
    tags: ["retro", "team", "improvement"],
    build: (idp) => [
      text(idp("title"), "Sprint retrospective", 80, 40, 32),
      ...columns(idp, ["Went well 🎉", "Could improve 🔧", "Ideas 💡", "Action items ✅"], ["#E9F7F1", "#FDECEC", "#FDF3E7", "#E3EAFF"], 80, 120, 320, 680),
    ],
  },
  {
    key: "canvas.swot",
    name: "SWOT analysis",
    description: "Strengths, weaknesses, opportunities and threats in four quadrants.",
    category: "Strategy",
    tags: ["swot", "strategy"],
    build: (idp) => [
      text(idp("title"), "SWOT analysis", 80, 40, 32),
      frame(idp("s"), "Strengths", 80, 120, 520, 400, "#E9F7F1"),
      frame(idp("w"), "Weaknesses", 640, 120, 520, 400, "#FDECEC"),
      frame(idp("o"), "Opportunities", 80, 560, 520, 400, "#E3EAFF"),
      frame(idp("t"), "Threats", 640, 560, 520, 400, "#FDF3E7"),
      sticky(idp("s1"), "", 120, 200, STICKY_COLORS[2], idp("s")),
      sticky(idp("w1"), "", 680, 200, STICKY_COLORS[1], idp("w")),
      sticky(idp("o1"), "", 120, 640, STICKY_COLORS[3], idp("o")),
      sticky(idp("t1"), "", 680, 640, STICKY_COLORS[5], idp("t")),
    ],
  },
  {
    key: "canvas.roadmap",
    name: "Product roadmap",
    description: "Now / Next / Later swimlanes per theme.",
    category: "Strategy",
    tags: ["roadmap", "product"],
    build: (idp) => {
      const out: CanvasObjectInput[] = [text(idp("title"), "Product roadmap", 80, 40, 32)];
      const cols = ["Now", "Next", "Later"];
      const lanes = ["Platform", "Growth", "Quality"];
      cols.forEach((c, i) => out.push(rect(idp(`h${i}`), 300 + i * 360, 120, 340, 56, "#E3EAFF", c)));
      lanes.forEach((l, j) => {
        out.push(rect(idp(`l${j}`), 80, 200 + j * 220, 200, 200, "#EEF1F8", l));
        cols.forEach((_, i) => out.push(sticky(idp(`i${i}_${j}`), i === 0 && j === 0 ? "Initiative" : "", 320 + i * 360, 240 + j * 220, STICKY_COLORS[(i + j) % 8])));
      });
      return out;
    },
  },
  {
    key: "canvas.kanban",
    name: "Kanban planning",
    description: "Lightweight visual board for planning before creating tasks.",
    category: "Agile",
    tags: ["kanban", "planning"],
    build: (idp) => columns(idp, ["Backlog", "To do", "In progress", "In review", "Done"], ["#EEF1F8", "#E3EAFF", "#FDF3E7", "#F3EEF9", "#E9F7F1"], 80, 100, 280, 760, [["Convert any note into a task from its menu"], [], [], [], []]),
  },
  {
    key: "canvas.agenda",
    name: "Meeting agenda",
    description: "Agenda items, notes, decisions and actions in one place.",
    category: "Meetings",
    tags: ["meeting", "agenda"],
    build: (idp) => [
      text(idp("title"), "Meeting agenda — <date>", 80, 40, 32),
      ...columns(idp, ["Agenda", "Notes", "Decisions", "Actions"], ["#EEF1F8", "#FDF3E7", "#E3EAFF", "#E9F7F1"], 80, 120, 320, 680, [["1. Welcome & goals", "2. Topic", "3. Wrap-up"], [], [], []]),
    ],
  },
  {
    key: "canvas.research",
    name: "Research board",
    description: "Cluster observations, insights and evidence from interviews.",
    category: "Research",
    tags: ["research", "insights", "affinity"],
    build: (idp) => [
      text(idp("title"), "Research synthesis", 80, 40, 32),
      ...columns(idp, ["Observations", "Insights", "Evidence", "Open questions"], ["#EEF1F8", "#E3EAFF", "#E9F7F1", "#FDF3E7"], 80, 120, 320, 680),
    ],
  },
];

export function buildCanvasTemplate(key: string, idPrefix: string): CanvasSnapshot | null {
  const def = CANVAS_TEMPLATES.find((t) => t.key === key);
  if (!def) return null;
  const idp = (s: string) => `${idPrefix}_${s}`;
  const objects = def.build(idp).map((o, i) => ({ ...o, zIndex: o.zIndex ?? i, createdAt: Date.now() }));
  // The snapshot is validated by the caller via applySnapshot (CanvasSnapshot.parse)
  return { schemaVersion: 1, meta: CanvasMeta.parse({}), objects: objects as CanvasSnapshot["objects"] };
}
