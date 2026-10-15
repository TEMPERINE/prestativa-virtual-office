import { describe, expect, it, vi } from "vitest";
import { createChatNotifier } from "../notifications";
import type { OfficeNotificationService } from "@/lib/notifications/notification-service";

function setup() {
  let foreground = true;
  const present = vi.fn(),
    open = vi.fn(),
    notify = vi.fn();
  const service: OfficeNotificationService = {
    kind: "desktop",
    getPermission: () => "granted",
    requestPermission: async () => "granted",
    isOptedIn: () => true,
    setOptedIn() {},
    isAppHidden: () => !foreground,
    focusApp: vi.fn(),
    notify,
  };
  const notifier = createChatNotifier({
    present,
    open,
    service: () => service,
    isForeground: () => foreground,
  });
  return {
    notifier,
    present,
    open,
    notify,
    service,
    background: () => {
      foreground = false;
    },
    foreground: () => {
      foreground = true;
    },
  };
}
const event = { conversationId: "c", peerName: "Colega", lastSeq: 1 };
describe("Chat through OfficeNotificationService", () => {
  it("foreground alert opens only that conversation, without native join routing", () => {
    const s = setup();
    s.notifier.receive(event);
    expect(s.present).toHaveBeenCalledTimes(1);
    expect(s.present.mock.calls[0][0]).toBe("Colega");
    s.present.mock.calls[0][1]();
    expect(s.open).toHaveBeenCalledWith("c");
    expect(s.notify).not.toHaveBeenCalled();
  });
  it("keeps background alert until foreground; duplicates don't spam", () => {
    const s = setup();
    s.background();
    s.notifier.receive(event);
    s.notifier.receive(event);
    expect(s.present).not.toHaveBeenCalled();
    s.foreground();
    s.notifier.flush();
    s.notifier.flush();
    expect(s.present).toHaveBeenCalledTimes(1);
  });
  it("only an explicit future chat capability is called; body has no message content", () => {
    const s = setup();
    const native = vi.fn();
    s.service.notifyChat = native;
    s.background();
    s.notifier.receive(event);
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Prestativa Office",
        body: "Colega enviou uma mensagem privada.",
        tag: "chat-c",
      }),
    );
    native.mock.calls[0][0].onClick();
    expect(s.open).toHaveBeenCalledWith("c");
    expect(s.notify).not.toHaveBeenCalled();
  });
  it("dispose and workspace teardown discard pending alerts", () => {
    const s = setup();
    s.background();
    s.notifier.receive(event);
    s.notifier.dispose();
    s.foreground();
    s.notifier.flush();
    s.notifier.receive({ ...event, lastSeq: 2 });
    expect(s.present).not.toHaveBeenCalled();
  });
});
