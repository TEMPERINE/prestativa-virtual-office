import type { Database } from "@/integrations/supabase/types";

export const CHAT_PAGE_SIZE = 40;
export const CHAT_MAX_LENGTH = 4000;
export type ChatMessageType = "text" | "sticker";
export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
type ChatConversationRow =
  Database["public"]["Functions"]["chat_list_conversations"]["Returns"][number];
// Generated RPC types omit nullability; these columns are null for empty conversations/profiles.
export type ChatConversation = Omit<
  ChatConversationRow,
  "last_message_at" | "last_body" | "last_type" | "last_sender_id" | "peer_sprite_id"
> & {
  last_message_at: string | null;
  last_body: string | null;
  last_type: string | null;
  last_sender_id: string | null;
  peer_sprite_id: string | null;
};
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
