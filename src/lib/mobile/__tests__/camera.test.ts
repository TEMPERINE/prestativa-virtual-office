import { expect, it } from "vitest";
import { mobileCameraCenter, mobileCameraPan } from "../camera";

it("iPhone portrait centers the avatar in the visible 390px window, not the 1266px map", () => {
  const pan = mobileCameraCenter({ width: 1266, height: 844 }, { width: 390, height: 844 }, { x: 0, y: 0 }, 1, { x: .65, y: .5 });
  expect(pan.x + .65 * 1266).toBe(195);
  expect(pan.y + .5 * 844).toBe(422);
});

it("iPhone landscape at zoom 1 keeps the entire map inside the visible window", () => {
  const pan = mobileCameraCenter({ width: 585, height: 390 }, { width: 844, height: 390 }, { x: 129.5, y: 0 }, 1, { x: .8, y: .5 });
  expect(pan).toEqual({ x: 0, y: 0 });
  expect(129.5 + pan.x + 585).toBeLessThanOrEqual(844);
});

it("portrait panning cannot expose space past the map edges", () => {
  const map = { width: 1266, height: 844 }, viewport = { width: 390, height: 844 };
  expect(mobileCameraPan(map, viewport, { x: 0, y: 0 }, 1, { x: -5000, y: -5000 })).toEqual({ x: -876, y: 0 });
  expect(mobileCameraPan(map, viewport, { x: 0, y: 0 }, 1, { x: 5000, y: 5000 })).toEqual({ x: 0, y: 0 });
});