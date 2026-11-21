import { describe, expect, it } from "vitest";
import { followMarker, isStraight, longerFirst, moveVertex, normalize, routeTo, type Pt } from "@/lib/drawings/route";

const tol = { x: 0.01, y: 0.01 };

describe("cable routing", () => {
  it("bends once at a right angle", () => {
    expect(routeTo({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.3 }, { straight: true, horizontalFirst: true, tol })).toEqual([{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.3 }]);
    expect(routeTo({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.3 }, { straight: true, horizontalFirst: false, tol })).toEqual([{ x: 0.1, y: 0.3 }, { x: 0.5, y: 0.3 }]);
  });

  it("lines up a nearly-straight click, but never moves a point pinned to a marker", () => {
    expect(routeTo({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.105 }, { straight: true, horizontalFirst: true, tol })).toEqual([{ x: 0.5, y: 0.1 }]);
    const pinned = routeTo({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.105, m: "K2" }, { straight: true, horizontalFirst: true, tol });
    expect(pinned.at(-1)).toEqual({ x: 0.5, y: 0.105, m: "K2" });
    expect(isStraight([{ x: 0.1, y: 0.1 }, ...pinned])).toBe(true);
  });

  it("goes straight to the point when free angles are allowed", () => {
    expect(routeTo({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.3 }, { straight: false, horizontalFirst: true, tol })).toEqual([{ x: 0.5, y: 0.3 }]);
  });

  it("goes along the longer distance first", () => {
    expect(longerFirst({ x: 0, y: 0 }, { x: 0.5, y: 0.2 })).toBe(true);
    expect(longerFirst({ x: 0, y: 0 }, { x: 0.2, y: 0.5 })).toBe(false);
    expect(longerFirst({ x: 0, y: 0 }, { x: 0.2, y: 0.3 }, 2)).toBe(true); // a wide sheet
  });

  it("tidies repeated points and bends that aren't bends, keeping marker pins", () => {
    const run: Pt[] = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0 }, { x: 0.4, y: 0 }, { x: 0.6, y: 0, m: "K2" }, { x: 0.8, y: 0 }, { x: 0.8, y: 0.5 }];
    expect(normalize(run)).toEqual([{ x: 0, y: 0 }, { x: 0.6, y: 0, m: "K2" }, { x: 0.8, y: 0 }, { x: 0.8, y: 0.5 }]);
  });

  it("dragging a bend keeps both segments straight", () => {
    const run: Pt[] = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }];
    const moved = moveVertex(run, 2, { x: 0.6, y: 0.6 }, true);
    expect(isStraight(moved)).toBe(true);
    expect(moved[0]).toEqual(run[0]);
    expect(moved.at(-1)).toEqual(run.at(-1));
  });

  it("a dragged end gets a new bend instead of breaking the run", () => {
    const run: Pt[] = [{ x: 0.1, y: 0.1, m: "K1" }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5, m: "K2" }];
    const moved = followMarker(run, "K1", { x: 0.2, y: 0.3 }, true);
    expect(moved[0]).toEqual({ x: 0.2, y: 0.3, m: "K1" });
    expect(moved.at(-1)).toEqual(run[2]);
    expect(isStraight(moved)).toBe(true);
  });

  it("a marker in the middle of a daisy chain drags the run with it", () => {
    const run: Pt[] = [{ x: 0.1, y: 0.2, m: "K1" }, { x: 0.5, y: 0.2, m: "K2" }, { x: 0.9, y: 0.2, m: "K3" }];
    const moved = followMarker(run, "K2", { x: 0.5, y: 0.4 }, true);
    expect(isStraight(moved)).toBe(true);
    expect(moved.filter((p) => p.m).map((p) => p.m)).toEqual(["K1", "K2", "K3"]);
    expect(moved.find((p) => p.m === "K2")).toEqual({ x: 0.5, y: 0.4, m: "K2" });
  });
});

describe("dragging a cable segment", () => {
  it("moves a middle segment sideways and keeps the run square", async () => {
    const { moveSegment, isStraight } = await import("@/lib/drawings/route");
    const run = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }];
    const moved = moveSegment(run, 2, 0.1, 0.3, true); // the vertical segment: only x changes
    expect(moved).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.6, y: 0.5 }, { x: 0.9, y: 0.5 }]);
    expect(isStraight(moved)).toBe(true);
  });

  it("an end segment gets stubs so the devices stay connected", async () => {
    const { moveSegment, isStraight, normalize } = await import("@/lib/drawings/route");
    const run = [{ x: 0.1, y: 0.2, m: "K1" }, { x: 0.9, y: 0.2, m: "K2" }];
    const moved = normalize(moveSegment(run, 1, 0, 0.1, true));
    expect(moved).toHaveLength(4);
    expect(moved[0]).toEqual(run[0]);
    expect(moved.at(-1)).toEqual(run[1]);
    expect(moved[1].y).toBeCloseTo(0.3);
    expect(isStraight(moved)).toBe(true);
  });

  it("a sloped segment gets a new bend in the middle", async () => {
    const { moveSegment } = await import("@/lib/drawings/route");
    const moved = moveSegment([{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }], 1, 0.1, 0, false);
    expect(moved).toHaveLength(3);
    expect(moved[1].x).toBeCloseTo(0.3);
    expect(moved[1].y).toBeCloseTo(0.2);
  });
});
