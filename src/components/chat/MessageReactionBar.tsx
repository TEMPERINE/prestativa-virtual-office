import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { SmilePlus } from "lucide-react";
import { AppleEmoji } from "./AppleEmoji";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** Anchored to its bubble, in the same fullscreen host as the Chat. */
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
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);
  const choose = (emoji: string) => {
    onOpenChange(false);
    onReact(emoji);
  };
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Anchor asChild>
        <span aria-hidden className="pointer-events-none absolute inset-0" />
      </Popover.Anchor>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Reagir à mensagem ${seq}`}
          disabled={busy}
          className="absolute right-7 top-1 hidden rounded bg-background/85 p-0.5 text-foreground shadow-sm sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 data-[state=open]:opacity-100"
        >
          <SmilePlus className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={host}>
        <Popover.Content
          aria-label="Reagir à mensagem"
          side="top"
          align={own ? "end" : "start"}
          sideOffset={8}
          collisionPadding={12}
          className="z-[380] max-h-[80dvh] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              onOpenChange(false);
            }
          }}
        >
          <div role="toolbar" aria-label="Reações rápidas" className="flex items-center gap-0.5">
            {QUICK.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Reagir com ${emoji}`}
                disabled={busy}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                onClick={() => choose(emoji)}
              >
                <AppleEmoji emoji={emoji} size={22} />
              </button>
            ))}
            <button
              type="button"
              aria-label="Mais emojis"
              aria-expanded={expanded}
              disabled={busy}
              className="h-8 w-8 shrink-0 rounded-full bg-muted text-xl hover:bg-accent"
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
