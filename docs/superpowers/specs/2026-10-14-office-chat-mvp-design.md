# Chat 1:1 — desenho do MVP autorizado

## Objetivo e base

Mensagens privadas persistentes entre duas colaboradoras do mesmo workspace, sem entrar em reunião. Pedido integral do responsável autoriza implementar o MVP, testar, commitar e fazer push; não autoriza SQL remoto, merge ou publicação. Base exata: `c29f9bb37b406179c133cfd7058b2db0fc89b162`; branch nova `codex/office-chat-mvp`. A branch local antiga era apenas um ponteiro para main sem commits exclusivos e foi avançada para essa base. Branch de segurança preservada.

Inventário somente do repositório: não há tabelas/RPCs/fluxo de chat. Não foi consultado o banco real. Dois modelos bastam: conversa com dois participantes e marcadores de leitura, mensagens append-only. Um terceiro modelo de recibos só seria necessário para grupos/duplo check, fora do MVP. Realtime usa Postgres Changes, nunca LiveKit DataChannel.

## Dados e autorização

`chat_conversations`: id, workspace_id, participant_a/b ordenados por UUID, created_at, updated_at, last_message_at, last_message_seq, participant_a_read_seq/b_read_seq. UNIQUE(workspace_id,participant_a,participant_b); CHECK a<b. `chat_messages`: id UUID fornecido como chave idempotente, conversation_id, sender_id derivado do ator, body, message_type text|sticker, seq monotônico por conversa, created_at. UNIQUE(conversation_id,seq); índices para paginação e inbox de cada participante.

RLS SELECT só permite um dos dois participantes com ambos ainda membros do workspace. Nenhuma policy global de Superadmin. Escritas só por RPCs protegidas, EXECUTE explícito a authenticated, SECURITY DEFINER owner postgres/search_path pg_catalog. Nenhuma alteração nas policies de tabelas existentes ou no schema platform_private. Membership é consultado diretamente, sem depender dos helpers/ACLs pendentes. As permissões legadas de autoentrada em workspace continuam um risco externo já reconhecido; não dão leitura de conversas das quais o ator não participa. O hardening separado permanece pendente por decisão explícita do responsável.

RPCs: chat_start_conversation(ws,peer), chat_send_message(cid,content,kind,message_id), chat_mark_read(cid,through_seq), chat_list_conversations(ws). Helper chat_can_access_conversation(cid) usa somente auth.uid(), sem ator por parâmetro. Helpers internos, caso necessários para locks, não têm EXECUTE de clientes. Nenhuma RPC recebe sender_id. Texto simples com Unicode/emojis (até 4000 caracteres); stickers por catálogo fixo, sem URL arbitrária, HTML, upload ou execução. Mutex por conversa serializa sequência/envio/leitura; membership validado com locks antes de escrita. Repetir message_id com o mesmo conteúdo retorna a mesma mensagem; reuso incompatível falha sem revelar outra conversa.

Unread conta mensagens do outro participante com seq acima do marcador do ator. Marcar leitura só avança o marcador próprio até o seq realmente carregado; chegada concorrente posterior permanece não lida. Paginação usa seq exclusivo, não offset nem relógio do cliente. Remover qualquer participante do workspace bloqueia novas leituras/envios para essa conversa; não normaliza nem altera memberships.

## Cliente e Realtime

API Supabase tipada; store isolado por workspace/usuário, sem import de RTC. Uma assinatura inbox com filtros participant_a=auth.uid e participant_b=auth.uid (INSERT/UPDATE). Nunca assinar mensagens globais do workspace. Uma assinatura de mensagens filtrada por conversation_id selecionado; cleanup invalida callbacks imediatamente. Inbox ignora outro workspace; RLS continua sendo a barreira real. Reconnect refaz snapshot/histórico recente, sem polling permanente. Dedupe por id, ordenação por seq, invalidação de respostas antigas ao trocar conversa/workspace ou desmontar.

Store público: connect/dispose/subscribe/getSnapshot, start(peer), select(cid), send(body,type), loadOlder(), markRead(seq), setReading(boolean), refresh(). Estado: conversations, selectedId, messages, hasMore, loading, loadingOlder, sending, error, connection. Retry de envio reutiliza o UUID da tentativa anterior com mesmo conteúdo, evitando duplicação após timeout.

## Office e UX

Um provider/store por sessão montada do workspace. OfficeScene permanece no mesmo ramo; painel é irmão visual e usa `?panel=chat`. Menu do avatar recebe callback Enviar mensagem; botão Mensagens na topbar abre lista e contador. Nome/avatar reutilizam SpriteAvatar. Lista ordenada por mensagem mais recente; thread com texto seguro, seletor simples de emojis/stickers, histórico incremental, estados vazio/erro/envio.

A composição atual bloqueia input local de movimento com qualquer painel; preservar essa regra para não mover avatar ao digitar. RTC/Presence/avatar continuam montados. ESC/Back fecham painel; não aceitar convite, teletransportar ou abrir navegador. Painel segue camadas do Office existentes; fullscreen usa host apropriado sem mudar controles de mídia. Homologar composição real, inclusive apresentação/share, antes de publicar.

Notificação MVP: toast interno com nome e texto genérico, sem conteúdo privado; unread persistente. Evitar alerta da própria mensagem, duplicata ou conversa visível no final do histórico. Background pode acumular alerta até voltar ao app. Reutilizar OfficeNotificationService por capacidade opcional notifyChat, deixada sem implementação nativa neste MVP; adapters Web/Desktop e fluxo de join-request permanecem intactos. Clique apenas abre a conversa. Native Web/Desktop será homologação/feature posterior.

Migration staged específica e independente, não aplicada; disponibilizar somente tabelas de chat na publicação Realtime. SQL aborta se objetos inesperados já existirem, sem substituir tabelas alheias. Ausência da migration resulta em mensagem amigável de indisponibilidade; não derruba Office nem causa retries infinitos.

## Aceite e exclusões

Testes Postgres descartável (sem rede/credenciais/SQL remoto): par único inclusive concorrência, A/B, terceiro e Superadmin não participante negados, sender impossível de falsificar, não membro negado, memberships removidos bloqueados, read monotônico/unread concorrente, paginação, replay idempotente e ausência de escrita direta. Vitest: transporte Realtime restrito, dedupe/cleanup, resposta stale, inbox/unread/leitura, reconnect, retry; UI real do painel integrada ao shell estável, envio/emoji/sticker, escape/texto seguro. Suite completa, typecheck e build.

Fora: grupos/canais, mídia/anexos/GIF/reação/edição/exclusão, typing, last seen, recibo duplo ou chamada. Não tocar Superadmin/reconciliação/fases4–6, ACLs privadas, mecanismo de sessão/movimento/RTC/Privacy Guard/Egress/R2. SQL local verifica o contrato; entrega real Realtime/Windows, JWT e layers exige homologação após autorização separada da migration.
