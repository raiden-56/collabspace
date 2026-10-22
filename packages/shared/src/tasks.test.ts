import { describe, expect, it } from "vitest";
import { wouldCreateCycle, blockedTaskIds, topologicalOrder, positionBetween, isOverdue, validateStatusTransition } from "./tasks";

describe("dependencies", () => {
  const edges = [
    { taskId: "B", dependsOnTaskId: "A" },
    { taskId: "C", dependsOnTaskId: "B" },
  ];
  it("detects direct and transitive cycles", () => {
    expect(wouldCreateCycle(edges, "A", "C")).toBe(true);
    expect(wouldCreateCycle(edges, "A", "B")).toBe(true);
    expect(wouldCreateCycle(edges, "A", "A")).toBe(true);
    expect(wouldCreateCycle(edges, "D", "C")).toBe(false);
    expect(wouldCreateCycle(edges, "A", "D")).toBe(false);
  });
  it("computes blocked tasks", () => {
    const blocked = blockedTaskIds(edges, (id) => id === "A");
    expect(blocked.has("B")).toBe(false);
    expect(blocked.has("C")).toBe(true);
  });
  it("orders topologically", () => {
    expect(topologicalOrder(["C", "B", "A"], edges)).toEqual(["A", "B", "C"]);
    expect(() =>
      topologicalOrder(["A", "B", "C"], [...edges, { taskId: "A", dependsOnTaskId: "C" }]),
    ).toThrow();
  });
});

describe("ordering & status", () => {
  it("positions between neighbours", () => {
    expect(positionBetween(null, null)).toBe(1000);
    expect(positionBetween(1000, null)).toBe(2000);
    expect(positionBetween(null, 1000)).toBe(0);
    expect(positionBetween(1000, 2000)).toBe(1500);
  });
  it("flags overdue tasks", () => {
    const now = new Date("2026-06-01");
    expect(isOverdue({ dueDate: "2026-05-01", completedAt: null }, now)).toBe(true);
    expect(isOverdue({ dueDate: "2026-05-01", completedAt: "2026-04-30" }, now)).toBe(false);
    expect(isOverdue({ dueDate: null, completedAt: null }, now)).toBe(false);
  });
  it("validates status against columns", () => {
    const cols = [
      { statusKey: "todo", isDone: false },
      { statusKey: "done", isDone: true },
    ];
    expect(validateStatusTransition(cols, "todo", "done")).toBeNull();
    expect(validateStatusTransition(cols, "todo", "nope")).toMatch(/Unknown/);
  });
});
