import { useState } from "react";

const BASE = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/";

/** Unicode → filename used by the same Apple set as emoji-picker-react. */
export function emojiUnified(emoji: string) {
  return [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join("-");
}

/** Visual-only Apple rendering; the stored value stays plain Unicode. Falls back to the glyph. */
export function AppleEmoji({ emoji, size = 18 }: { emoji: string; size?: number }) {
  const full = emojiUnified(emoji);
  const stripped = full.replace(/-fe0f/g, "");
  const candidates = full === stripped ? [full] : [full, stripped];
  const [attempt, setAttempt] = useState(0);
  if (attempt >= candidates.length)
    return <span style={{ fontSize: size * 0.9, lineHeight: 1 }}>{emoji}</span>;
  return (
    <img
      src={`${BASE}${candidates[attempt]}.png`}
      alt={emoji}
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      className="inline-block select-none align-middle"
      onError={() => setAttempt((n) => n + 1)}
    />
  );
}
