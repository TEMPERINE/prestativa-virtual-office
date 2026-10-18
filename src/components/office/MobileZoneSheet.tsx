import { useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ZoneSheetAction = { id: string; label: string; onSelect: () => void; tone?: "primary" | "danger" };

/**
 * Touch-only bottom sheet for desks/areas. Opening never runs an action;
 * the user confirms inside. Tap on backdrop, the close button or a swipe
 * down closes it. Respects the bottom safe area.
 */
export function MobileZoneSheet({
  title,
  subtitle,
  actions,
  onClose,
}: {
  title: string;
  subtitle?: string;
  actions: ZoneSheetAction[];
  onClose: () => void;
}) {
  const startY = useRef<number | null>(null);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-no-map-gesture data-testid="mobile-zone-sheet" className="fixed inset-0 z-[400]">
      <button
        type="button"
        aria-label="Fechar painel"
        className="absolute inset-0 bg-black/40 border-0 p-0"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-background text-foreground shadow-2xl border-t px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] animate-in slide-in-from-bottom duration-200 motion-reduce:animate-none"
        onPointerDown={(e) => { startY.current = e.clientY; }}
        onPointerUp={(e) => {
          if (startY.current != null && e.clientY - startY.current > 60) onClose();
          startY.current = null;
        }}
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose} className="shrink-0 h-11 w-11 rounded-full flex items-center justify-center hover:bg-muted active:scale-95">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {actions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ação disponível aqui.</p>}
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.onSelect}
              className={`min-h-11 rounded-xl px-4 text-sm font-semibold active:scale-[0.98] transition-transform ${
                a.tone === "danger" ? "bg-destructive text-destructive-foreground" : a.tone === "primary" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
