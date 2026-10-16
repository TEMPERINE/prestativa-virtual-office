import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ChatExtrasApi, ChatPin } from "@/lib/chat/extras";
import type { ChatMessage } from "@/lib/chat/types";

export const ChatExtrasApiContext = createContext<ChatExtrasApi | null>(null);

export type ThreadExtras = {
  pin: ChatPin | null;
  favorites: Set<string>;
  togglePin: (message: ChatMessage) => Promise<void>;
  toggleFavorite: (message: ChatMessage) => Promise<void>;
};
export const ThreadExtrasContext = createContext<ThreadExtras | null>(null);
export const useThreadExtras = () => useContext(ThreadExtrasContext);

/** Per selected conversation; never touches the chat store, RTC or Presence. */
export function useConversationExtras(api: ChatExtrasApi | null, cid: string | null) {
  const [pin, setPin] = useState<ChatPin | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  useEffect(() => {
    setPin(null);
    setFavorites(new Set());
    if (!api || !cid) return;
    let alive = true;
    void api
      .pin(cid)
      .then((p) => alive && setPin(p))
      .catch(() => {});
    void api
      .favorites(cid)
      .then((ids) => alive && setFavorites(new Set(ids)))
      .catch(() => {});
    const off = api.watchPin(cid, (p) => alive && setPin(p));
    return () => {
      alive = false;
      off();
    };
  }, [api, cid]);
  const togglePin = useCallback(
    async (message: ChatMessage) => {
      if (!api || !cid) return;
      try {
        setPin(await api.setPin(cid, pin?.message_id === message.id ? null : message.id));
      } catch {
        toast.error("Não foi possível fixar a mensagem.");
      }
    },
    [api, cid, pin],
  );
  const toggleFavorite = useCallback(
    async (message: ChatMessage) => {
      if (!api || !cid) return;
      const next = !favorites.has(message.id);
      try {
        await api.setFavorite(cid, message.id, next);
        setFavorites((old) => {
          const copy = new Set(old);
          if (next) copy.add(message.id);
          else copy.delete(message.id);
          return copy;
        });
      } catch {
        toast.error("Não foi possível atualizar os favoritos.");
      }
    },
    [api, cid, favorites],
  );
  const value = useMemo<ThreadExtras | null>(
    () => (api && cid ? { pin, favorites, togglePin, toggleFavorite } : null),
    [api, cid, pin, favorites, togglePin, toggleFavorite],
  );
  return value;
}
