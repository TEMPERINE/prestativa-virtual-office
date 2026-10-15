// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { ChatState } from "@/lib/chat/store";

const KEY = "office-chat-panel-position";
const state: ChatState = {
  conversations: [],
  selectedId: null,
  messages: [],
  hasMore: false,
  loading: false,
  loadingOlder: false,
  sending: false,
  loadingList: false,
  available: true,
  error: null,
  connection: "online",
};
let panelWidth = 760;
function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}
function show(onClose = vi.fn()) {
  const parentDown = vi.fn(),
    parentMove = vi.fn();
  const view = render(
    <div onPointerDown={parentDown} onPointerMove={parentMove}>
      <ChatPanel state={state} store={null} userId="fixture" onClose={onClose} />
    </div>,
  );
  const panel = screen.getByRole("dialog", { name: "Mensagens privadas" });
  const header = screen.getByText("Mensagens").closest("header")!;
  return { ...view, panel, header, onClose, parentDown, parentMove };
}
const position = (panel: HTMLElement) => ({
  x: parseFloat(panel.style.left),
  y: parseFloat(panel.style.top),
});
function pointer(target: Element, type: string, x: number, y: number, id = 7, button = 0) {
  fireEvent(
    target,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      isPrimary: true,
      button,
      clientX: x,
      clientY: y,
    }),
  );
}
beforeEach(() => {
  localStorage.clear();
  viewport(1280, 900);
  panelWidth = 760;
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      isPrimary: boolean;
      constructor(type: string, options: PointerEventInit = {}) {
        super(type, options);
        this.pointerId = options.pointerId ?? 0;
        this.isPrimary = options.isPrimary ?? true;
      }
    },
  );
  const captured = new WeakMap<HTMLElement, number>();
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, id: number) {
      captured.set(this, id);
    }),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(function (this: HTMLElement) {
      captured.delete(this);
    }),
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: function (this: HTMLElement, id: number) {
      return captured.get(this) === id;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches("[data-office-chat-panel]"))
      return new DOMRect(
        0,
        0,
        Math.min(panelWidth, innerWidth - 24),
        Math.min(850, innerHeight - 72),
      );
    if (this.tagName === "HEADER") return new DOMRect(0, 0, panelWidth, 52);
    return new DOMRect();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of ["setPointerCapture", "releasePointerCapture", "hasPointerCapture"])
    Reflect.deleteProperty(HTMLElement.prototype, key);
  Reflect.deleteProperty(document, "fullscreenElement");
});

it("places the desktop window using its measured width and the original top/right margins", () => {
  panelWidth = 600;
  const { panel } = show();
  expect(position(panel)).toEqual({ x: 668, y: 56 });
  expect(panel.style.right).toBe("auto");
  expect(panel.style.bottom).toBe("auto");
});
it("drags only from free header space, captures the pointer and saves only visual coordinates", () => {
  const { panel, header, parentDown, parentMove } = show();
  pointer(screen.getByText("Mensagens"), "pointerdown", 900, 80);
  expect(header.hasPointerCapture(7)).toBe(true);
  pointer(header, "pointermove", 700, 180);
  expect(position(panel)).toEqual({ x: 308, y: 156 });
  expect(header.style.cursor).toBe("grabbing");
  expect(parentDown).not.toHaveBeenCalled();
  expect(parentMove).not.toHaveBeenCalled();
  pointer(header, "pointerup", 700, 180);
  expect(header.hasPointerCapture(7)).toBe(false);
  expect(header.style.cursor).toBe("grab");
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ x: 308, y: 156 });
  pointer(header, "pointermove", 500, 300);
  expect(position(panel)).toEqual({ x: 308, y: 156 });
});
it("close remains clickable and never starts dragging", () => {
  const { panel, header, onClose } = show();
  const before = position(panel),
    close = screen.getByLabelText("Fechar mensagens");
  pointer(close, "pointerdown", 1000, 80);
  pointer(header, "pointermove", 600, 200);
  expect(position(panel)).toEqual(before);
  expect(header.hasPointerCapture(7)).toBe(false);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
});
it.each([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role=button]",
  "[tabindex]",
  "[contenteditable]",
])("ignores future interactive header targets: %s", (kind) => {
  const { panel, header } = show();
  const interactive = document.createElement(kind.startsWith("[") ? "span" : kind);
  if (kind === "[role=button]") interactive.setAttribute("role", "button");
  if (kind === "[tabindex]") interactive.setAttribute("tabindex", "0");
  if (kind === "[contenteditable]") interactive.setAttribute("contenteditable", "true");
  const child = document.createElement("span");
  if (!["input", "select", "textarea"].includes(kind)) interactive.append(child);
  header.append(interactive);
  const before = position(panel);
  pointer(interactive.contains(child) ? child : interactive, "pointerdown", 900, 80);
  pointer(header, "pointermove", 400, 200);
  expect(position(panel)).toEqual(before);
  expect(header.hasPointerCapture(7)).toBe(false);
});
it("body interactions do not drag or propagate pointerdown to the Office", () => {
  const { panel, header, parentDown } = show();
  const before = position(panel);
  pointer(screen.getByRole("navigation"), "pointerdown", 900, 200);
  pointer(header, "pointermove", 500, 300);
  expect(position(panel)).toEqual(before);
  expect(parentDown).not.toHaveBeenCalled();
});
it("clamps both axes so the entire header remains reachable inside the viewport", () => {
  const { panel, header } = show();
  pointer(header, "pointerdown", 900, 80);
  pointer(header, "pointermove", -5000, -5000);
  expect(position(panel)).toEqual({ x: 12, y: 12 });
  pointer(header, "pointermove", 5000, 5000);
  expect(position(panel)).toEqual({ x: 508, y: 836 });
  expect(position(panel).y + 52).toBeLessThanOrEqual(innerHeight - 12);
});
it("restores position on reopen without changing it on pointerdown", () => {
  localStorage.setItem(KEY, JSON.stringify({ x: 100, y: 150 }));
  const first = show();
  expect(position(first.panel)).toEqual({ x: 100, y: 150 });
  pointer(first.header, "pointerdown", 140, 170);
  pointer(first.header, "pointermove", 220, 200);
  pointer(first.header, "pointerup", 220, 200);
  first.unmount();
  expect(position(show().panel)).toEqual({ x: 180, y: 180 });
});
it("clamps an offscreen saved position and strips unexpected stored fields", () => {
  localStorage.setItem(KEY, JSON.stringify({ x: 99999, y: -500, extra: "discard" }));
  expect(position(show().panel)).toEqual({ x: 508, y: 12 });
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ x: 508, y: 12 });
});
it.each(["broken", "null", "[]", '{"x":"200","y":100}', '{"x":1}', '{"x":1e999,"y":1}'])(
  "safely replaces malformed position: %s",
  (value) => {
    localStorage.setItem(KEY, value);
    expect(position(show().panel)).toEqual({ x: 508, y: 56 });
  },
);
it("resize clamps an old position into the new viewport and ends any active drag", () => {
  localStorage.setItem(KEY, JSON.stringify({ x: 508, y: 700 }));
  const { panel, header } = show();
  pointer(header, "pointerdown", 600, 720);
  viewport(800, 500);
  fireEvent(window, new Event("resize"));
  expect(position(panel)).toEqual({ x: 28, y: 436 });
  expect(header.hasPointerCapture(7)).toBe(false);
  pointer(header, "pointermove", 100, 100);
  expect(position(panel)).toEqual({ x: 28, y: 436 });
});
it.each([375, 639])("keeps mobile layout and disables dragging below sm (%s px)", (width) => {
  viewport(width, 800);
  localStorage.setItem(KEY, JSON.stringify({ x: 200, y: 100 }));
  const { panel, header } = show();
  expect(panel.style.left).toBe("");
  expect(panel.style.top).toBe("");
  pointer(header, "pointerdown", 200, 80);
  pointer(header, "pointermove", 100, 180);
  expect(header.hasPointerCapture(7)).toBe(false);
  expect(panel.style.left).toBe("");
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ x: 200, y: 100 });
  viewport(1024, 800);
  fireEvent(window, new Event("resize"));
  expect(position(panel)).toEqual({ x: 200, y: 100 });
});
it("moves its portal and reclamps when entering or leaving fullscreen", () => {
  const fullscreen = document.createElement("div");
  document.body.append(fullscreen);
  let current: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
  const { panel } = show();
  expect(panel.parentElement).toBe(document.body);
  const header = screen.getByText("Mensagens").closest("header")!;
  pointer(header, "pointerdown", 900, 80);
  pointer(header, "pointermove", 850, 100);
  viewport(900, 500);
  act(() => {
    current = fullscreen;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  const moved = screen.getByRole("dialog", { name: "Mensagens privadas" });
  expect(moved.parentElement).toBe(fullscreen);
  expect(position(moved)).toEqual({ x: 128, y: 76 });
  expect(screen.getByText("Mensagens").closest("header")!.style.cursor).toBe("grab");
  act(() => {
    current = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  expect(screen.getByRole("dialog").parentElement).toBe(document.body);
  fullscreen.remove();
});
it.each(["pointercancel", "lostpointercapture"])(
  "ends drag safely on %s and ignores unrelated pointer IDs",
  (ending) => {
    const { panel, header } = show();
    pointer(header, "pointerdown", 900, 80);
    pointer(header, "pointermove", 700, 180, 8);
    expect(position(panel)).toEqual({ x: 508, y: 56 });
    pointer(header, "pointermove", 700, 180);
    pointer(header, ending, 700, 180);
    pointer(header, "pointermove", 500, 300);
    expect(position(panel)).toEqual({ x: 308, y: 156 });
    expect(header.style.cursor).toBe("grab");
  },
);
it("ignores non-primary mouse buttons", () => {
  const { panel, header } = show();
  pointer(header, "pointerdown", 900, 80, 7, 2);
  pointer(header, "pointermove", 500, 300);
  expect(position(panel)).toEqual({ x: 508, y: 56 });
});
it("continues working when localStorage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const { panel, header } = show();
  pointer(header, "pointerdown", 900, 80);
  pointer(header, "pointermove", 700, 180);
  pointer(header, "pointerup", 700, 180);
  expect(position(panel)).toEqual({ x: 308, y: 156 });
});

it("reclamps fullscreen viewport changes even when the portal host remains body", () => {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: document.body,
  });
  const { panel } = show();
  viewport(900, 500);
  fireEvent(document, new Event("fullscreenchange"));
  expect(position(panel)).toEqual({ x: 128, y: 56 });
});

it("allows header dragging inside a focusable fullscreen host", () => {
  const fullscreen = document.createElement("div");
  fullscreen.tabIndex = 0;
  document.body.append(fullscreen);
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreen });
  const { panel, header } = show();
  pointer(header, "pointerdown", 900, 80);
  pointer(header, "pointermove", 700, 180);
  expect(position(panel)).toEqual({ x: 308, y: 156 });
  pointer(header, "pointerup", 700, 180);
  fullscreen.remove();
});
