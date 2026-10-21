import { describe, expect, it } from "vitest";
import { authorizeIce, authorizeV1Room, parseV1RoomWorkspace } from "../rtc-access";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const memberOf = (ws: string) => async (w: string) => w === ws;

describe("RTC V1 token authorization", () => {
  it("rejects arbitrary room names", async () => {
    await expect(authorizeV1Room("qualquer-sala", memberOf(A))).rejects.toThrow("RTC_V1_ROOM_INVALID");
    expect(parseV1RoomWorkspace(`prestativa-office:${A}:lobby`)).toBeNull();
  });
  it("blocks user without membership (anonymous / visitor)", async () => {
    await expect(authorizeV1Room(`prestativa-office:${A}:sala-1`, async () => false)).rejects.toThrow("RTC_V1_NOT_MEMBER");
  });
  it("blocks member of workspace A from workspace B", async () => {
    await expect(authorizeV1Room(`prestativa-office:${B}:sala-1`, memberOf(A))).rejects.toThrow("RTC_V1_NOT_MEMBER");
  });
  it("allows member of the room's workspace", async () => {
    await expect(authorizeV1Room(`prestativa-office:${A}:sala-1`, memberOf(A))).resolves.toBe(A);
  });
});

describe("ICE/TURN authorization", () => {
  it("blocks missing workspace", async () => {
    await expect(authorizeIce(undefined, async () => true)).rejects.toThrow("ICE_INVALID_WORKSPACE");
  });
  it("blocks anonymous without runtime access", async () => {
    await expect(authorizeIce(A, async () => false)).rejects.toThrow("ICE_FORBIDDEN");
  });
  it("blocks user from another workspace", async () => {
    await expect(authorizeIce(B, memberOf(A))).rejects.toThrow("ICE_FORBIDDEN");
  });
  it("allows member or active visitor of the workspace", async () => {
    await expect(authorizeIce(A, memberOf(A))).resolves.toBe(A);
  });
});
