import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { SmilePlus } from "lucide-react";
import { AppleEmoji } from "./AppleEmoji";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const GAP = 8; // distance between bubble and pill
const EDGE = 8; // keep fully visible inside the viewport

/** Pure placement: above the bubble (start/end aligned), below if no room, clamped to viewport. */
export function placeReactionBar(
  anchor: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  own: boolean,
) {
  let top = anchor.top - GAP - size.height;
  let side: "top" | "bottom" = "top";
  if (top < EDGE) {
    top = anchor.bottom + GAP;
    side = "bottom";
  }
  top = Math.max(EDGE, Math.min(top, viewport.height - size.height - EDGE));
  let left = own ? anchor.right - size.width : anchor.left;
  left = Math.max(EDGE, Math.min(left, viewport.width - size.width - EDGE));
  return { top, left, side };
}

/** Anchored to the real bubble element, rendered in the same (fullscreen) host as the Chat. */
export function MessageReactionBar({
  open,
  onOpenChange,
  seq,
  own,
  host,
  busy,
  onReact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seq: number;
  own: boolean;
  host: Element;
  busy: boolean;
  onReact: (emoji: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: "top" | "bottom" } | null>(
    null,
  );
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setPos(null);
    }
  }, [open]);

  const update = useCallback(() => {
    const a = anchorRef.current;
    const c = contentRef.current;
    if (!a || !c) return;
    const r = a.getBoundingClientRect();
    const next = placeReactionBar(
      r,
      { width: c.offsetWidth, height: c.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      own,
    );
    setPos((old) =>
      old && old.top === next.top && old.left === next.left && old.side === next.side
        ? old
        : next,
    );
  }, [own]);

  // Follow the bubble: list scroll, chat drag, resize, fullscreen, content growth.
  useLayoutEffect(() => {
    if (!open) return;
    update();
    let frame = 0;
    const loop = () => {
      update();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, expanded, update]);

  // Click outside / ESC close.
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => {
      const t = event.target as Node;
      if (contentRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onOpenChange]);

  const choose = (emoji: string) => {
    onOpenChange(false);
    onReact(emoji);
  };
  return (
    <>
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Reagir à mensagem ${seq}`}
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        disabled={busy}
        className="absolute right-7 top-1 hidden rounded bg-background/85 p-0.5 text-foreground shadow-sm sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 data-[state=open]:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={contentRef}
            role="dialog"
            aria-label="Reagir à mensagem"
            data-chat-reaction-bar
            data-side={pos?.side ?? "top"}
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
              transformOrigin: `${own ? "right" : "left"} ${pos?.side === "bottom" ? "top" : "bottom"}`,
            }}
            className={`chat-reaction-pop z-[380] max-h-[80dvh] max-w-[calc(100vw-16px)] overflow-y-auto border border-border/60 bg-popover text-popover-foreground shadow-[0_4px_16px_-4px_hsl(0_0%_0%/0.25)] ${expanded ? "rounded-2xl p-1.5" : "rounded-full px-1.5 py-1"}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div role="toolbar" aria-label="Reações rápidas" className="flex items-center gap-1">
              {QUICK.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Reagir com ${emoji}`}
                  disabled={busy}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  onClick={() => choose(emoji)}
                >
                  <AppleEmoji emoji={emoji} size={26} />
                </button>
              ))}
              <button
                type="button"
                aria-label="Mais emojis"
                aria-expanded={expanded}
                disabled={busy}
                className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-lg leading-none text-muted-foreground hover:bg-accent"
                onClick={() => setExpanded((value) => !value)}
              >
                +
              </button>
            </div>
            {expanded && (
              <div className="mt-2 w-[320px] max-w-[calc(100vw-40px)] overflow-hidden">
                <EmojiPicker
                  emojiStyle={EmojiStyle.APPLE}
                  theme={Theme.AUTO}
                  width="100%"
                  height={340}
                  previewConfig={{ showPreview: false }}
                  searchPlaceholder="Buscar emoji..."
                  onEmojiClick={(value) => choose(value.emoji)}
                />
              </div>
            )}
          </div>,
          host,
        )}
    </>
  );
}
