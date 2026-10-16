import type { Database } from "@/integrations/supabase/types";

export const CHAT_PAGE_SIZE = 40;
export const CHAT_MAX_LENGTH = 4000;
export type ChatMessageType = "text" | "sticker";
type MessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
// Interaction columns stay optional so older payloads and fixtures remain valid.
export type ChatMessage = Omit<
  MessageRow,
  "body" | "reply_to_message_id" | "is_forwarded" | "cancelled_at" | "deleted_at"
> & {
  body: string | null;
  reply_to_message_id?: string | null;
  is_forwarded?: boolean;
  cancelled_at?: string | null;
  deleted_at?: string | null;
};
export type ChatReaction = {
  message_id: string;
  conversation_id: string;
  user_id: string;
  emoji: string | null;
  created_at: string;
  revision: number;
};
export type ChatContact = { id: string; name: string; sprite_id: string | null };
type ChatConversationRow =
  Database["public"]["Functions"]["chat_list_conversations"]["Returns"][number];
// Generated RPC types omit nullability; these columns are null for empty conversations/profiles.
export type ChatConversation = Omit<
  ChatConversationRow,
  "last_message_at" | "last_body" | "last_type" | "last_sender_id" | "peer_sprite_id"
> & {
  own_delivered_seq?: number;
  peer_delivered_seq?: number;
  peer_read_seq?: number;
  last_deleted_at?: string | null;
  last_cancelled_at?: string | null;
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
    replyTo?: string | null,
  ): Promise<ChatMessage>;
  read(conversationId: string, through: number): Promise<void>;
  supportsInteractions?(): boolean;
  resetCapabilities?(): void;
  undelivered?(cid: string, after: number): Promise<ChatMessage[]>;
  delivered?(cid: string, through: number): Promise<void>;
  reactions?(cid: string, ids: string[]): Promise<ChatReaction[]>;
  lookup?(cid: string, ids: string[]): Promise<ChatMessage[]>;
  react?(cid: string, id: string, emoji: string | null): Promise<ChatReaction>;
  delete?(cid: string, id: string): Promise<ChatMessage>;
  cancel?(cid: string, id: string): Promise<ChatMessage>;
  forward?(cid: string, id: string, peerId: string, requestId: string): Promise<ChatMessage>;
  contacts?(workspaceId: string): Promise<ChatContact[]>;
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
    reaction?: (reaction: ChatReaction) => void,
  ): () => void;
}
export type IncomingChat = { conversationId: string; peerName: string; lastSeq: number };
