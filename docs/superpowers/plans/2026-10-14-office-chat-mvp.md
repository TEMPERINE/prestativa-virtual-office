# Office Chat MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this authorized request inline. Steps use checkbox tracking.

**Goal:** Chat privado 1:1 persistente integrado ao Office, independente de mídia.
**Architecture:** Duas tabelas com RLS de participantes/membership, RPCs para mutações, Postgres Changes restrito e store por workspace/usuário. Painel irmão do OfficeScene, serviço de notificações existente com capacidade futura opcional.
**Tech Stack:** React19, TypeScript, TanStack Router, Supabase/Postgres/Realtime, Vitest, PostgreSQL16 Docker descartável.
**Spec:** [desenho autorizado](../specs/2026-10-14-office-chat-mvp-design.md).

## Global Constraints

- Branch codex/office-chat-mvp desde c29f9bb37b406179c133cfd7058b2db0fc89b162; não alterar branch de segurança.
- Nenhum SQL remoto/db push/merge/publicação. Migration somente staged. Superadmin e ACLs pendentes intocados.
- Ator exclusivamente auth.uid(); Superadmin não lê conversa de terceiros. Mesmo workspace e dois memberships válidos.
- OfficeScene/RTC/RoomManager/Presence/movimento/sessão/Privacy Guard/gravação não mudam de ownership ou lifecycle.
- Sem novas dependências; mensagens texto/emoji/sticker estático. Sem estado paralelo de mídia ou convites.

## Review Focus

- Revogação de membership entre validação e escrita: bloquear/validar dentro da transação; terceiro nunca obtém dados via RPC/helper.
- Timeout após commit: retry não duplica mensagem nem falsifica sender.
- Reconnect/subscribe enquanto chega mensagem: snapshot não perde evento, listeners antigos não atualizam nova conversa/workspace.
- Leitura concorrente com chegada e usuário olhando histórico antigo: unread só zera até mensagem realmente visível.
- Office persistente/inputs/overlays/erros sem migration: chat não derruba cena, liga mídia ou bloqueia join-request.

### Task 1: Persistência e autorização

**Files:** criar supabase/staged-migrations/20261014220000_office_chat_mvp.sql, supabase/tests/office-chat/authorization.sql, scripts/test_office_chat.py; estender somente tipos de chat em src/integrations/supabase/types.ts.
**Interfaces:** chat_start_conversation(ws uuid,peer uuid)→uuid; chat_send_message(cid uuid,content text,kind text,message_id uuid)→jsonb message; chat_mark_read(cid uuid,through_seq bigint)→void; chat_list_conversations(ws uuid)→typed rows com peer, preview, seq e unread_count. SELECT chat_messages ordenável por seq.
- [x] Escrever e executar regressões RED RLS/terceiros/sender/idempotência/unread/cursor/par concorrente.
- [x] Implementar SQL transacional independente, grants explícitos, publication somente chat, sem alterar objetos existentes.
- [x] Executar testes GREEN e concorrência; registrar limitações do harness. Conferir tipos com os contratos.

### Task 2: API, store, Realtime e notificação

**Files:** src/lib/chat/{types,api,realtime,store,notifications,stickers}.ts e __tests__/*.test.ts; extensão opcional da interface existente de notificações.
**Consumes:** RPCs/Row acima.
**Produces:** createChatStore(deps) com connect/dispose/subscribe/getSnapshot/start/select/send/loadOlder/markRead/setReading/refresh; adapter API; subscribeInbox(ws,uid,callbacks) e subscribeMessages(cid,callbacks), ambos retornam cleanup. PAGE_SIZE=40, MAX_MESSAGE_LENGTH=4000.
- [x] RED: filtragem A/B/cid, dedupe, cleanup, stale request, retry, paginação, unread/refetch e leitura só visível, reconnect.
- [x] Implementar store e adapter sem React/RTC, merge por id+seq, cursor exclusivo e UUID idempotente; mensagens de erro seguras.
- [x] GREEN: testes específicos; nenhum canal global de mensagens, timers/listeners limpos.

### Task 3: UI integrada e validação final

**Files:** src/components/chat/{OfficeChat,ChatPanel,ChatThread}.tsx e testes; src/lib/office/overlay.ts; src/components/office/OfficeScene.tsx; src/routes/_authenticated/workspaces.$workspaceId.tsx; docs/chat/office-chat-mvp.md.
**Consumes:** API/store e catálogo, Profile SpriteAvatar, OfficeNotificationService existente.
**Produces:** OfficeChat provider/surface, useOfficeChat para menu/topbar, painel ?panel=chat, unread e ação de notificação que abre conversa.
- [x] RED: abrir/fechar/reabrir sem desmontar cena, lista/conversa/envio/emoji/sticker, read só quando visível no fim, texto escapado, erro amigável sem migration.
- [x] Implementar menu/topbar/painel como wiring de UI; preservar bloqueio de movimento e camadas/handlers existentes.
- [x] GREEN: testes de UI e suite completa, typecheck, build e SQL. Atualizar instruções de aplicação isolada/homologação, nunca executar no banco real.
- [x] Revisão independente final; reproduzir e corrigir achados materiais em uma rodada, revalidar.

Finalização autorizada: commit/push apenas na branch nova, confirmar SHA remoto e preservar SHA da branch segurança.
