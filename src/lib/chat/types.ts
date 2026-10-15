import type { Database } from "@/integrations/supabase/types";

export const CHAT_PAGE_SIZE = 40;
export const CHAT_MAX_LENGTH = 4000;
export type ChatMessageType = "text" | "sticker";
export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
export type ChatConversation =
  Database["public"]["Functions"]["chat_list_conversations"]["Returns"][number];
export type ChatPage = { messages: ChatMessage[]; hasMore: boolean };
export type ChatStatus = "connecting" | "online" | "offline";

export interface ChatApi {
  list(workspaceId: string): Promise<ChatConversation[]>;
  start(workspaceId: string, peerId: string): Promise<string>;
  history(conversationId: string, before?: number): Promise<ChatPage>;
  send(
    conversationId: string,
    body: string,
    type: ChatMessageType,
    id: string,
  ): Promise<ChatMessage>;
  read(conversationId: string, through: number): Promise<void>;
}
export interface ChatRealtime {
  inbox(
    workspaceId: string,
    userId: string,
    changed: () => void,
    status: (status: ChatStatus) => void,
  ): () => void;
  messages(
    conversationId: string,
    received: (message: ChatMessage) => void,
    ready: () => void,
  ): () => void;
}
export type IncomingChat = { conversationId: string; peerName: string; lastSeq: number };
