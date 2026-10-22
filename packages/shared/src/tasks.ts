/**
 * Task domain logic: dependency graphs, status transitions, metrics.
 * Pure functions so they can be unit-tested and reused on client & server.
 */

export interface DependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

/**
 * Returns true if adding edge (taskId depends on dependsOnTaskId) would create a cycle.
 * Graph semantics: an edge A→B means "A depends on B" (B blocks A).
 */
export function wouldCreateCycle(existing: DependencyEdge[], taskId: string, dependsOnTaskId: string): boolean {
  if (taskId === dependsOnTaskId) return true;
  const adj = new Map<string, string[]>();
  for (const e of existing) {
    const list = adj.get(e.taskId) ?? [];
    list.push(e.dependsOnTaskId);
    adj.set(e.taskId, list);
  }
  // If dependsOnTaskId (transitively) depends on taskId, adding taskId→dependsOnTaskId closes a loop.
  const stack = [dependsOnTaskId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/** Task ids that are blocked: they depend on at least one task which is not done. */
export function blockedTaskIds(edges: DependencyEdge[], isDone: (taskId: string) => boolean): Set<string> {
  const blocked = new Set<string>();
  for (const e of edges) if (!isDone(e.dependsOnTaskId)) blocked.add(e.taskId);
  return blocked;
}

/** Topological order (Kahn). Tasks with no dependencies come first. Throws on cycle. */
export function topologicalOrder(taskIds: string[], edges: DependencyEdge[]): string[] {
  const indeg = new Map<string, number>(taskIds.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!indeg.has(e.taskId) || !indeg.has(e.dependsOnTaskId)) continue;
    indeg.set(e.taskId, (indeg.get(e.taskId) ?? 0) + 1);
    const list = out.get(e.dependsOnTaskId) ?? [];
    list.push(e.taskId);
    out.set(e.dependsOnTaskId, list);
  }
  const queue = taskIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== taskIds.length) throw new Error("Dependency graph contains a cycle");
  return order;
}

export const DEFAULT_BOARD_COLUMNS = [
  { name: "Backlog", statusKey: "backlog", color: "#A0A9BC", isDone: false },
  { name: "To Do", statusKey: "todo", color: "#5B8CFF", isDone: false },
  { name: "In Progress", statusKey: "in_progress", color: "#F4B740", isDone: false },
  { name: "In Review", statusKey: "in_review", color: "#9B7BFF", isDone: false },
  { name: "Done", statusKey: "done", color: "#31B887", isDone: true },
] as const;

export type DefaultStatusKey = (typeof DEFAULT_BOARD_COLUMNS)[number]["statusKey"];

export interface ColumnLike {
  statusKey: string;
  isDone: boolean;
}

/** Validate a status transition against a board's columns. Returns the error message or null. */
export function validateStatusTransition(columns: ColumnLike[], from: string, to: string): string | null {
  if (!columns.some((c) => c.statusKey === to)) return `Unknown status "${to}" for this board`;
  if (from === to) return null;
  return null;
}

export function isDoneStatus(columns: ColumnLike[], status: string): boolean {
  return columns.some((c) => c.statusKey === status && c.isDone);
}

/** Compute a position between two neighbours for fractional ordering. */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1000;
  if (before == null) return (after as number) - 1000;
  if (after == null) return before + 1000;
  return (before + after) / 2;
}

export const PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;

export function isOverdue(task: { dueDate: Date | string | null; completedAt: Date | string | null }, now = new Date()): boolean {
  if (!task.dueDate || task.completedAt) return false;
  return new Date(task.dueDate).getTime() < now.getTime();
}
