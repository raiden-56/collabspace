import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  writeObject,
  updateObject,
  deleteObjects,
  serializeCanvas,
  applySnapshot,
  canvasText,
  alignObjects,
  distributeObjects,
  autoAnchors,
  resolveConnectorEnd,
  objectBounds,
  CanvasObject,
} from "./canvas";
import { buildCanvasTemplate, CANVAS_TEMPLATES } from "./templates/canvas";

describe("canvas serialization", () => {
  it("round-trips objects through a Yjs doc", () => {
    const doc = new Y.Doc();
    writeObject(doc, { id: "a", type: "sticky", x: 10, y: 20, width: 180, height: 120, text: "Hello", color: "#FFE66D" });
    writeObject(doc, { id: "b", type: "rect", x: 300, y: 20, width: 100, height: 80, fill: "#FFF" });
    writeObject(doc, { id: "c", type: "connector", x: 0, y: 0, from: { objectId: "a", side: "right" }, to: { objectId: "b", side: "left" } });
    const snap = serializeCanvas(doc);
    expect(snap.objects).toHaveLength(3);
    const a = snap.objects.find((o) => o.id === "a")!;
    expect(a.text).toBe("Hello");
    expect(a.fontSize).toBe(16);
    const doc2 = new Y.Doc();
    applySnapshot(doc2, snap);
    expect(serializeCanvas(doc2)).toEqual(snap);
  });

  it("merges concurrent property edits from two clients", () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    writeObject(d1, { id: "a", type: "sticky", x: 0, y: 0, text: "one" });
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    updateObject(d1, "a", { x: 100 });
    updateObject(d2, "a", { text: "two" });
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2));
    const o1 = serializeCanvas(d1).objects[0]!;
    const o2 = serializeCanvas(d2).objects[0]!;
    expect(o1).toEqual(o2);
    expect(o1.x).toBe(100);
    expect(o1.text).toBe("two");
  });

  it("detaches connectors when a target object is deleted", () => {
    const doc = new Y.Doc();
    writeObject(doc, { id: "a", type: "rect", x: 0, y: 0, width: 50, height: 50 });
    writeObject(doc, { id: "b", type: "rect", x: 200, y: 0, width: 50, height: 50 });
    writeObject(doc, { id: "c", type: "connector", x: 0, y: 0, from: { objectId: "a", side: "right" }, to: { objectId: "b", side: "left" } });
    deleteObjects(doc, ["b"]);
    const snap = serializeCanvas(doc);
    expect(snap.objects).toHaveLength(2);
    const c = snap.objects.find((o) => o.id === "c")!;
    expect(c.to && "x" in c.to).toBe(true);
  });

  it("extracts searchable text", () => {
    const doc = new Y.Doc();
    writeObject(doc, { id: "a", type: "sticky", x: 0, y: 0, text: "Alpha idea", tags: ["ux"] });
    writeObject(doc, { id: "f", type: "frame", x: 0, y: 0, title: "Section 1" });
    const t = canvasText(serializeCanvas(doc));
    expect(t).toContain("Alpha idea");
    expect(t).toContain("Section 1");
    expect(t).toContain("ux");
  });
});

describe("canvas geometry", () => {
  const mk = (id: string, x: number, y: number, w = 100, h = 50) => CanvasObject.parse({ id, type: "rect", x, y, width: w, height: h });
  it("aligns left and centers", () => {
    const res = alignObjects([mk("a", 0, 0), mk("b", 50, 100)], "left");
    expect(res.find((r) => r.id === "b")!.x).toBe(0);
    const c = alignObjects([mk("a", 0, 0), mk("b", 50, 100)], "centerX");
    expect(c.find((r) => r.id === "a")!.x).toBe(25);
  });
  it("distributes evenly", () => {
    const res = distributeObjects([mk("a", 0, 0), mk("b", 110, 0), mk("c", 500, 0)], "x");
    expect(res.find((r) => r.id === "b")!.x).toBe(250);
  });
  it("picks anchors and resolves connector ends", () => {
    const a = objectBounds(mk("a", 0, 0));
    const b = objectBounds(mk("b", 300, 0));
    expect(autoAnchors(a, b)).toEqual({ from: "right", to: "left" });
    expect(resolveConnectorEnd({ objectId: "a", side: "right" }, (id) => (id === "a" ? a : null))).toEqual({ x: 100, y: 25 });
  });
});

describe("canvas templates", () => {
  it("every template builds a valid snapshot whose connectors point at existing objects", () => {
    for (const t of CANVAS_TEMPLATES) {
      const snap = buildCanvasTemplate(t.key, "tpl")!;
      const doc = new Y.Doc();
      applySnapshot(doc, snap);
      const out = serializeCanvas(doc);
      expect(out.objects.length).toBeGreaterThan(0);
      const ids = new Set(out.objects.map((o) => o.id));
      for (const o of out.objects) {
        if (o.type !== "connector") continue;
        for (const end of [o.from, o.to]) if (end && "objectId" in end) expect(ids.has(end.objectId)).toBe(true);
      }
    }
  });
});
