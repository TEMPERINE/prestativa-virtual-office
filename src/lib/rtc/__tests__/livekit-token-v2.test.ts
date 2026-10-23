import { describe, it, expect, vi } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import {
  issueLiveKitTokenV2,
  TokenV2Error,
  type TokenV2Deps,
  type OfficeSessionRow,
} from "../livekit-token-v2";
import { roomNameFor as rmRoomNameFor } from "../livekit-room-manager";
import { roomNameFor } from "../room-names";

const KEY = "APItestkey";
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const URL_ = "wss://example.livekit.cloud";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";

const COLS = 128,
  ROWS = 80;
function mapData(painted: Record<string, number>) {
  const zones = new Array(COLS * ROWS).fill(null);
  let i = 0;
  for (const [id, n] of Object.entries(painted)) for (let k = 0; k < n; k++) zones[i++] = id;
  return {
    cols: COLS,
    rows: ROWS,
    blocked: [],
    zones,
    customZones: [{ id: "custom-work", label: "W", color: "#000", kind: "workspace" }],
  };
}

function makeDeps(
  o: Partial<{
    members: Record<string, string[]>;
    sessions: Record<string, OfficeSessionRow>;
    map: { data: unknown; version: number } | null;
    visitors: Record<string, string[]>;
  }> = {},
) {
  const members = o.members ?? { [WS]: [U1, U2] };
  const sessions = o.sessions ?? {
    [U1]: { user_id: U1, session_id: S1, generation: 5, workspace_id: WS, active: true },
    [U2]: { user_id: U2, session_id: S2, generation: 2, workspace_id: WS, active: true },
  };
  const map =
    o.map === undefined ? { data: mapData({ reuniao: 4, "custom-work": 2 }), version: 7 } : o.map;
  const deps: TokenV2Deps = {
    canAccessRuntime: vi.fn(
      async (w, u) => (members[w] ?? []).includes(u) || (o.visitors?.[w] ?? []).includes(u),
    ),
    isWorkspaceMember: vi.fn(async (w, u) => (members[w] ?? []).includes(u)),
    getOfficeSession: vi.fn(async (u) => sessions[u] ?? null),
    getCanonicalMap: vi.fn(async () => map),
    getDisplayName: vi.fn(async () => "Fulano"),
    config: { url: URL_, apiKey: KEY, apiSecret: SECRET },
  };
  return deps;
}

const lobby = (x: Record<string, unknown> = {}) => ({
  context: "LOBBY",
  workspaceId: WS,
  sessionId: S1,
  generation: 5,
  mapVersion: 7,
  ...x,
});
const priv = (x: Record<string, unknown> = {}) => ({
  ...lobby({ context: "PRIVATE_ROOM", zoneId: "reuniao" }),
  ...x,
});

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof TokenV2Error ? e.code : String(e);
  }
}
const verify = (t: string) => new TokenVerifier(KEY, SECRET).verify(t);

describe("LiveKit token v2", () => {
  it("1. não autenticado é rejeitado", async () => {
    expect(await code(issueLiveKitTokenV2(null, lobby(), makeDeps()))).toBe("UNAUTHENTICATED");
  });
  it("2. não membro é rejeitado", async () => {
    expect(
      await code(issueLiveKitTokenV2(U1, lobby(), makeDeps({ members: { [WS]: [U2] } }))),
    ).toBe("NOT_MEMBER");
  });
  it("3. sessão inexistente é rejeitada", async () => {
    expect(await code(issueLiveKitTokenV2(U1, lobby(), makeDeps({ sessions: {} })))).toBe(
      "SESSION_INVALID",
    );
  });
  it("4. sessão de outro usuário é rejeitada", async () => {
    // U1 tenta usar sessionId/generation de U2
    expect(
      await code(issueLiveKitTokenV2(U1, lobby({ sessionId: S2, generation: 2 }), makeDeps())),
    ).toBe("SESSION_INVALID");
  });
  it("5. sessionId incorreto é rejeitado", async () => {
    expect(await code(issueLiveKitTokenV2(U1, lobby({ sessionId: S2 }), makeDeps()))).toBe(
      "SESSION_INVALID",
    );
  });
  it("6. generation antiga é rejeitada", async () => {
    expect(await code(issueLiveKitTokenV2(U1, lobby({ generation: 4 }), makeDeps()))).toBe(
      "SESSION_INVALID",
    );
  });
  it("7. sessão active=false é rejeitada", async () => {
    const d = makeDeps({
      sessions: {
        [U1]: { user_id: U1, session_id: S1, generation: 5, workspace_id: WS, active: false },
      },
    });
    expect(await code(issueLiveKitTokenV2(U1, lobby(), d))).toBe("SESSION_INVALID");
  });
  it("8. sessão de outro workspace é rejeitada", async () => {
    const d = makeDeps({
      members: { [WS]: [U1], [WS2]: [U1] },
      sessions: {
        [U1]: { user_id: U1, session_id: S1, generation: 5, workspace_id: WS2, active: true },
      },
    });
    expect(await code(issueLiveKitTokenV2(U1, lobby(), d))).toBe("SESSION_INVALID");
  });
  it("9. LOBBY válido gera room name correto", async () => {
    const r = await issueLiveKitTokenV2(U1, lobby(), makeDeps());
    expect(r.roomName).toBe(`prestativa-office:${WS}:lobby`);
  });
  it("10. PRIVATE_ROOM válida gera room name correto", async () => {
    const r = await issueLiveKitTokenV2(U1, priv(), makeDeps());
    expect(r.roomName).toBe(`prestativa-office:${WS}:reuniao`);
  });
  it("11. roomName do browser é rejeitado", async () => {
    expect(await code(issueLiveKitTokenV2(U1, lobby({ roomName: "x" }), makeDeps()))).toBe(
      "INVALID_INPUT",
    );
  });
  it("12. userId/identity/apiKey/apiSecret do browser são rejeitados", async () => {
    for (const k of ["userId", "identity", "apiKey", "apiSecret"]) {
      expect(await code(issueLiveKitTokenV2(U1, lobby({ [k]: U1 }), makeDeps()))).toBe(
        "INVALID_INPUT",
      );
    }
    expect(await code(issueLiveKitTokenV2(U1, lobby({ context: "OFFLINE" }), makeDeps()))).toBe(
      "INVALID_INPUT",
    );
  });
  it("13. zona inexistente é rejeitada", async () => {
    expect(await code(issueLiveKitTokenV2(U1, priv({ zoneId: "feedback" }), makeDeps()))).toBe(
      "ZONE_NOT_FOUND",
    ); // não pintada
    expect(await code(issueLiveKitTokenV2(U1, priv({ zoneId: "nao-existe" }), makeDeps()))).toBe(
      "ZONE_NOT_FOUND",
    );
  });
  it("14. local de trabalho (workspace) também vira ZONE_ROOM", async () => {
    expect(await code(issueLiveKitTokenV2(U1, priv({ zoneId: "custom-work" }), makeDeps()))).toBe(
      "OK",
    );
    // mapa base (sem overrides): diretoria é workspace e sem vídeo → ZONE_ROOM
    const d = makeDeps({ map: null });
    expect(
      await code(issueLiveKitTokenV2(U1, priv({ zoneId: "diretoria", mapVersion: 0 }), d)),
    ).toBe("OK");
    expect(await code(issueLiveKitTokenV2(U1, priv({ zoneId: "reuniao", mapVersion: 0 }), d))).toBe(
      "OK",
    );
  });
  it("15. mapVersion antiga é rejeitada com MAP_VERSION_STALE", async () => {
    expect(await code(issueLiveKitTokenV2(U1, priv({ mapVersion: 6 }), makeDeps()))).toBe(
      "MAP_VERSION_STALE",
    );
  });
  it("16–21. claims: identity, room, roomJoin, publish/subscribe, sem roomAdmin, TTL ~10min", async () => {
    const r = await issueLiveKitTokenV2(U1, priv(), makeDeps());
    const c = await verify(r.token);
    expect(c.sub).toBe(U1);
    expect(c.video?.room).toBe(`prestativa-office:${WS}:reuniao`);
    expect(c.video?.roomJoin).toBe(true);
    expect(c.video?.canPublish).toBe(true);
    expect(c.video?.canSubscribe).toBe(true);
    expect(c.video?.roomAdmin).toBeFalsy();
    expect(c.video?.roomCreate).toBeFalsy();
    const ttl = (c.exp as number) - (c.nbf as number);
    expect(ttl).toBeGreaterThanOrEqual(590);
    expect(ttl).toBeLessThanOrEqual(610);
  });
  it("22. usuários diferentes recebem identities diferentes", async () => {
    const d = makeDeps();
    const a = await verify((await issueLiveKitTokenV2(U1, lobby(), d)).token);
    const b = await verify(
      (await issueLiveKitTokenV2(U2, lobby({ sessionId: S2, generation: 2 }), d)).token,
    );
    expect(a.sub).toBe(U1);
    expect(b.sub).toBe(U2);
  });
  it("23. uma chamada gera somente um token (sem retry)", async () => {
    const d = makeDeps();
    const r = await issueLiveKitTokenV2(U1, lobby(), d);
    expect(typeof r.token).toBe("string");
    expect(d.getOfficeSession).toHaveBeenCalledTimes(1);
    expect(d.canAccessRuntime).toHaveBeenCalledTimes(1);
    expect(await code(issueLiveKitTokenV2(U1, priv({ mapVersion: 1 }), d))).toBe(
      "MAP_VERSION_STALE",
    );
    expect(d.getCanonicalMap).toHaveBeenCalledTimes(1);
  });
  it("24. nenhum secret na resposta", async () => {
    const r = await issueLiveKitTokenV2(U1, priv(), makeDeps());
    expect(Object.keys(r).sort()).toEqual(["roomName", "token", "url"]);
    const s = JSON.stringify(r);
    expect(s).not.toContain(SECRET);
    expect(s).not.toContain(KEY.slice(3) + '"');
    expect(s).not.toContain(S1);
  });
  it("25. helper de room name é o mesmo no servidor e no RoomManager", () => {
    expect(rmRoomNameFor).toBe(roomNameFor);
    const ctxs = [
      { kind: "LOBBY" },
      { kind: "PRIVATE_ROOM", zoneId: "reuniao" },
      { kind: "OFFLINE" },
    ] as const;
    for (const c of ctxs) expect(rmRoomNameFor(WS, c)).toBe(roomNameFor(WS, c));
  });
});

describe("Token V2 — visitante ativo", () => {
  const V = "55555555-5555-4555-8555-555555555555";
  const SV = "66666666-6666-4666-8666-666666666666";
  const vsess = { user_id: V, session_id: SV, generation: 1, workspace_id: WS, active: true };
  const visitorMap = {
    data: mapData({ reuniao: 2, feedback: 2, diretoria: 2, supervisao: 2, "atendente-1": 2, descompressao: 2, "custom-work": 2 }),
    version: 7,
  };
  const deps = (visitors: Record<string, string[]> = { [WS]: [V] }) =>
    makeDeps({ visitors, map: visitorMap, sessions: { [V]: vsess, [U1]: { user_id: U1, session_id: S1, generation: 5, workspace_id: WS, active: true } } });
  const vreq = (x: Record<string, unknown> = {}) => priv({ sessionId: SV, generation: 1, ...x });

  it("lobby: PASS", async () => {
    expect(await code(issueLiveKitTokenV2(V, lobby({ sessionId: SV, generation: 1 }), deps()))).toBe("OK");
  });
  for (const z of ["diretoria", "supervisao", "atendente-1", "descompressao", "custom-work"])
    it(`${z}: PASS (Room da zona)`, async () => {
      const r = await issueLiveKitTokenV2(V, vreq({ zoneId: z }), deps());
      expect(r.roomName).toBe(roomNameFor(WS, { kind: "PRIVATE_ROOM", zoneId: z }));
    });
  for (const z of ["reuniao", "feedback"])
    it(`${z} (sala de vídeo/reunião): sem token`, async () => {
      expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: z }), deps()))).toBe("VISITOR_ZONE_FORBIDDEN");
    });
  it("membro continua entrando em reunião e Diretoria", async () => {
    for (const z of ["reuniao", "diretoria"]) expect(await code(issueLiveKitTokenV2(U1, priv({ zoneId: z }), deps()))).toBe("OK");
  });
  it("expirado/revogado/anônimo sem convite (sem runtime): bloqueado", async () => {
    expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: "diretoria" }), deps({})))).toBe("NOT_MEMBER");
  });
  it("visitante de A não recebe token de B", async () => {
    expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: "diretoria", workspaceId: WS2 }), deps()))).toBe("NOT_MEMBER");
  });
  it("mapVersion stale, sessão e generation continuam validados", async () => {
    expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: "diretoria", mapVersion: 6 }), deps()))).toBe("MAP_VERSION_STALE");
    expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: "diretoria", generation: 2 }), deps()))).toBe("SESSION_INVALID");
    expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: "diretoria", sessionId: S2 }), deps()))).toBe("SESSION_INVALID");
  });
  it("zona inexistente no mapa canônico: recusada", async () => {
    expect(await code(issueLiveKitTokenV2(V, vreq({ zoneId: "inventada" }), deps()))).toBe("ZONE_NOT_FOUND");
  });
});
