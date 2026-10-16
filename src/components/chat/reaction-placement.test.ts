import { describe, expect, it } from "vitest";
import { placeReactionBar } from "./MessageReactionBar";
const vp = { width: 1000, height: 800 };
const size = { width: 300, height: 44 };
const bubble = { top: 400, bottom: 460, left: 200, right: 500 };
describe("placeReactionBar", () => {
  it("received: above the bubble, aligned left, 4px gap", () => {
    expect(placeReactionBar(bubble, size, vp, false)).toEqual({ top: 352, left: 200, side: "top" });
  });
  it("own: above the bubble, aligned right", () => {
    expect(placeReactionBar(bubble, size, vp, true).left).toBe(200);
    expect(placeReactionBar({ ...bubble, right: 900 }, size, vp, true).left).toBe(600);
  });
  it("near the top: opens below", () => {
    expect(placeReactionBar({ ...bubble, top: 20, bottom: 80 }, size, vp, false)).toMatchObject({ top: 84, side: "bottom" });
  });
  it("near side edges: stays fully visible", () => {
    expect(placeReactionBar({ ...bubble, left: -50 }, size, vp, false).left).toBe(8);
    expect(placeReactionBar({ ...bubble, right: 1100 }, size, vp, true).left).toBe(692);
  });
  it("near the bottom: clamped inside viewport", () => {
    expect(placeReactionBar({ top: 20, bottom: 790, left: 0, right: 10 }, size, vp, false).top).toBe(748);
  });
});
