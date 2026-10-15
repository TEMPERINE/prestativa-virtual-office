# Chat Message Interactions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline for this explicitly authorized implementation. Track steps with checkboxes. One fresh final reviewer; one fix pass and revalidation before commit/push.

**Goal:** Interações seguras em mensagens do Chat 1:1 sem mudar Office/mídia.
**Architecture:** SQL incremental scoped, receipts por cursor, worker de entrega/reconciliação no store existente, UI modular por mensagem. Compatibilidade MVP por negociação de RPC v2.
**Tech Stack:** Postgres/Supabase Realtime, React/TypeScript, Radix e emoji-picker-react existentes, Vitest, Docker PostgreSQL16 sem rede.
**Spec:** ../specs/2026-10-15-chat-message-interactions-design.md

## Global Constraints

Base b4a86f3a1594e40d8f5772a5a8c520972521ce6e; mesma branch. Não alterar migrations aplicadas/security, RoomManager/RTC/Presence/movimento/share/gravação ou dependências. Nenhuma aplicação remota, merge/publicação. Somente {x,y} visual já existente pode usar storage.

## Review Focus

- Read versus cancelar concorrentes: lock comum e conteúdo irrecuperável via consultas normais após cancelamento.
- Eventos/snapshot antigos após cancelamento/reação: não ressuscitar conteúdo e não trocar workspace/cid por resposta atrasada.
- Recipient não seleciona conversa/reconecta com >40 pendências: só confirmar entrega de páginas realmente recebidas, sem falso read.
- Forward múltiplo com resposta perdida: IDs estáveis por destino, nenhuma referência privada nem deadlock entre conversas.
- Composer/menu/modal em fullscreen, drag e IME: preservar cena/canais, teclado e posição flutuante.

### Task 1 — SQL e autorização
Files: staged SQL/espelho Drizzle novos; supabase/tests/office-chat/interactions.sql; scripts/test_office_chat.py.
Interfaces: chat_list_conversations_v2(ws)→jsonb array com campos legados+own_delivered_seq/peer_delivered_seq/peer_read_seq; chat_mark_delivered(cid,through_seq); chat_send_message_v2(cid,content,kind,message_id,reply_to default null)→jsonb; chat_set_reaction(cid,message_id,emoji nullable)→jsonb; chat_cancel_message(cid,message_id)→jsonb; chat_forward_message(cid,message_id,peer,forward_id)→jsonb; chat_list_contacts(ws)→jsonb array. Reação SELECT scoped por conversation_id. Read/send MVP preservados via wrappers compatíveis.
- [x] RED SQL: receipts monotônicos, reação add/change/remove, terceiro/Superadmin negados, reply cross-cid, forward sem origem e retry, cancel entregue não lida permitido, read bloqueia cancel, tombstone não permite ações, constraints/grants, corridas read/cancel e forward.
- [x] Implementar transação postgres confiável e espelho staged; nenhuma nova migration ativa ou journal.
- [x] GREEN: suite SQL MVP e nova suite isoladas, fingerprints dos objetos fora do Chat intactos.

### Task 2 — contratos, API/store/Realtime
Files: src/lib/chat/{types,api,realtime,store}.ts, novos helpers receipt/reconciliation se necessário e testes correspondentes; somente tipos Chat em src/integrations/supabase/types.ts.
Consumes: SQL Task1. Produces: ChatState interactions/reactions/replyMessages/contacts/actionsPending; store.react/cancel/forward/loadContacts/revealMessage; send(body,type,replyId?); callbacks reactions opcionais no channel existente.
- [x] RED: v2 ausente mantém MVP, sender derivado, receipt só após receber dados; >40 backlog, read focado apenas; UPDATE cancela/redige snapshots atrasados; revision dedupe; lookup reply scoped; retry por destinatário e stale response.
- [x] Implementar API typed sem any, actor somente servidor; sem polling ou listeners duplicados.
- [x] GREEN: novos e antigos unitários, reconexão recupera todas páginas/reactions/reply previews.

### Task 3 — UI integrada
Files: ChatThread.tsx e novos ChatMessageItem/MessageActions/ForwardMessagesDialog/MessageInfoDialog (nomes exatos conforme responsabilidade), testes UI; ChatPanel/floating hook/OfficeScene preservados.
Consumes: store/API e helpers Task2. Produces: menu, reações, reply composer/jump, forward multi, clipboard, cancel/erro e receipts/info.
- [x] RED UI: menus por ownership/read/tombstone, reply/emoji/sticker/copy, forwarding múltiplo, confirmação de cancel, info sem timestamp inventado, fullscreen e Office persistente.
- [x] Implementar primitives existentes com host correto, popup dentro da composição real; nenhuma mídia paralela.
- [x] GREEN: Chat suite e integração real de Office/drag; erro/empty/cancelled/loading funcionam.

### Task 4 — entrega
- [x] npm ci, Bun frozen lock, SQL, Chat/Vitest completos, typecheck/build; corrigir somente falhas justificadas.
- [x] Revisão final independente, tratar Critical/Important e revalidar numa rodada.
- [x] Documentar SQL/grants/rollback, aplicação futura isolada e homologação. Conferir diff protegido; commit/push na branch e SHA remoto; não aplicar SQL.
