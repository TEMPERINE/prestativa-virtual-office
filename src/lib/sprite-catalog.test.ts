import { describe, expect, it } from "vitest";
import { DEFAULT_SPRITE_ID, getSprite, groupSpritesByGender, SPRITES } from "./sprite-catalog";

describe("additional characters", () => {
  it.each([{ id: "jorg", gender: "m" }, { id: "cat", gender: "f" }])("registers $id in its selection group", ({ id, gender }) => {
    const sprite = getSprite(id);
    expect(sprite.id).toBe(id);
    expect(sprite.gender).toBe(gender);
    expect(groupSpritesByGender(SPRITES).find((g) => g.key === gender)?.items.some((s) => s.id === id)).toBe(true);
    expect(sprite.mirrorRightFromLeft).toBe(true);
    expect(sprite.sheets.right).toBe(sprite.sheets.left);
    expect(sprite.dims.right).toEqual(sprite.dims.left);
  });

  it("preserves the existing default character", () => {
    expect(DEFAULT_SPRITE_ID).toBe("marcio");
    expect(getSprite(null).id).toBe("marcio");
    expect(getSprite("unknown").id).toBe("marcio");
  });

  it("hides experimental variants (V5, 1x, 2x) from the selection groups", () => {
    SPRITES.push({ ...getSprite("marcio"), id: "marcio-2x", label: "Márcio 2x", variant: true });
    const ids = groupSpritesByGender(SPRITES).flatMap((g) => g.items.map((s) => s.id));
    expect(ids).not.toContain("marcio-2x");
    expect(ids).not.toContain("marcio-v5");
    expect(ids).not.toContain("marcio-r1");
    expect(ids).toContain("marcio");
  });
});