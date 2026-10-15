/** Fixed local stickers: no upload, remote URL, animation or user-supplied SVG. */
export const CHAT_STICKERS = [
  { id: "hello", label: "Oi!", glyph: "👋", color: "#fff2cb" },
  { id: "thanks", label: "Obrigada!", glyph: "💖", color: "#ffe4f0" },
  { id: "coffee", label: "Café?", glyph: "☕", color: "#f2e8dc" },
  { id: "celebrate", label: "Boa!", glyph: "🎉", color: "#e8e4ff" },
] as const;
export const findChatSticker = (id: string) => CHAT_STICKERS.find((s) => s.id === id);
