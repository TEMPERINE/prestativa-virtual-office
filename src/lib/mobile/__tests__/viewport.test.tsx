// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { mobileFullscreenStyle, readMobileViewport } from "../viewport";
import { useChatPanelPosition } from "@/components/chat/use-chat-panel-position";

function env(coarse: boolean, vv: { height: number; offsetTop: number } | null, w = 390, h = 844) {
  window.matchMedia = ((q: string) => ({ matches: q.includes("coarse") ? coarse : false, addEventListener() {}, removeEventListener() {} })) as never;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv ? { ...vv, addEventListener() {}, removeEventListener() {} } : undefined });
}
afterEach(() => env(false, null, 1280, 800));

it("teclado aberto: Chat fica com a altura visível (composer acima do teclado)", () => {
  env(true, { height: 500, offsetTop: 0 });
  const vp = readMobileViewport();
  expect(vp.keyboardOpen).toBe(true);
  expect(mobileFullscreenStyle(vp)).toEqual({ top: 0, height: 500, bottom: "auto" });
});
it("teclado fechado volta ao tamanho cheio; abrir/fechar repetido é estável", () => {
  for (let i = 0; i < 3; i++) {
    env(true, { height: 500, offsetTop: 0 });
    expect(readMobileViewport().keyboardOpen).toBe(true);
    env(true, { height: 844, offsetTop: 0 });
    expect(readMobileViewport().keyboardOpen).toBe(false);
    expect(mobileFullscreenStyle(readMobileViewport())).toMatchObject({ height: 844 });
  }
});
it("sem VisualViewport usa 100dvh; mouse não recebe estilo mobile", () => {
  env(true, null);
  expect(mobileFullscreenStyle(readMobileViewport())).toEqual({ top: 0, height: "100dvh" });
  env(false, { height: 500, offsetTop: 0 }, 1280, 800);
  expect(mobileFullscreenStyle(readMobileViewport())).toBeUndefined();
});
it("orientação detectada por proporção da tela", () => {
  env(true, null, 844, 390);
  expect(readMobileViewport().orientation).toBe("landscape");
});
it("Chat: arrastável no desktop, nunca com toque", () => {
  env(false, null, 1280, 800);
  const desk = renderHook(() => useChatPanelPosition(document.body));
  expect(desk.result.current.headerStyle?.cursor).toBe("grab");
  env(true, null, 1280, 800);
  const touch = renderHook(() => useChatPanelPosition(document.body));
  expect(touch.result.current.headerStyle).toBeUndefined();
});
