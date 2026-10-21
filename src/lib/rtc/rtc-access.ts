// Regras puras de autorização para endpoints RTC legados (V1 LiveKit e ICE/TURN).
// V2 (livekit-token-v2) não usa este módulo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sala V1 = `prestativa-office:<workspaceId>:<zoneId>`; zona lobby nunca usa V1. */
export function parseV1RoomWorkspace(roomName: string): string | null {
  const parts = roomName.split(":");
  if (parts.length !== 3 || parts[0] !== "prestativa-office") return null;
  const [, ws, zone] = parts;
  if (!UUID.test(ws) || !zone || zone === "lobby") return null;
  return ws.toLowerCase();
}

/** V1 só para membros reais do workspace da sala (visitantes não ganham V1). */
export async function authorizeV1Room(
  roomName: string,
  isMember: (workspaceId: string) => Promise<boolean>,
): Promise<string> {
  const ws = parseV1RoomWorkspace(roomName);
  if (!ws) throw new Error("RTC_V1_ROOM_INVALID");
  if (!(await isMember(ws))) throw new Error("RTC_V1_NOT_MEMBER");
  return ws;
}

/** TURN só com acesso real ao runtime (membro ou visitante ativo) do workspace. */
export async function authorizeIce(
  workspaceId: unknown,
  canAccessRuntime: (workspaceId: string) => Promise<boolean>,
): Promise<string> {
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) throw new Error("ICE_INVALID_WORKSPACE");
  if (!(await canAccessRuntime(workspaceId))) throw new Error("ICE_FORBIDDEN");
  return workspaceId;
}
