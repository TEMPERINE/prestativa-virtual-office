# Chat 1:1 — interações de mensagem

Pedido integral autorizado pelo responsável: reações, respostas, encaminhamento, copiar, cancelamento antes da leitura, receipts e informações. Base remota confirmada b4a86f3a1594e40d8f5772a5a8c520972521ce6e em codex/office-chat-mvp. Preservar janela flutuante, Office persistente e invariantes do AGENTS.md. Nenhum SQL remoto, merge ou publicação.

## Modelo mínimo e segurança

- Conversa ganha delivered_seq de cada participante, inicializado a partir do read_seq já comprovado. Read também avança delivered; ambos monotônicos e limitados à última sequência. Sent significa row persistida. Status compara seq com os cursores do destinatário retornados pelo servidor.
- Mensagem ganha reply_to_message_id, is_forwarded, cancelled_at; body nullable somente no tombstone cancelado. FK composta exige reply na mesma conversa; RPC rejeita alvo cancelado. Cancelamento e read usam o mesmo lock transacional de conversa: vence a operação que obtiver esse lock primeiro. Cancelar após read falha com SQLSTATE PCH01.
- chat_message_reactions tem message_id/user_id únicos, conversation_id para filtro Realtime, emoji nullable e revision crescente. Remover reação cria tombstone por UPDATE; não depender de DELETE Realtime sem filtro/RLS. FK composta impede divergência entre mensagem e conversa.
- Novas mutações SECURITY DEFINER, search_path pg_catalog, auth.uid como ator; sem INSERT/UPDATE/DELETE cliente, sem override Superadmin. Reações e operações exigem os dois memberships atuais. Mensagem cancelada não aceita novas ações.
- Encaminhar cria uma mensagem independente por destinatário, conteúdo copiado no servidor, somente is_forwarded, sem origem/autor/reply privados. Dois locks de conversa em ordem UUID evitam deadlock em encaminhamentos cruzados. Cada destino tem UUID de retry; falha parcial não reenvia destinos confirmados.
- Cancelamento remove body da row e invalida reações. Não pode apagar clipboard ou cópias já encaminhadas; não restaura conteúdo no rollback. Referências de reply continuam apontando ao tombstone, nunca armazenam cópia do texto.

## Sincronização e compatibilidade

- Manter RPCs do MVP. Novas list/send versionadas evitam mudar retorno de função existente; frontend detecta recurso ausente e mantém o Chat MVP utilizável antes da aplicação autorizada.
- Entrega só é confirmada depois de o cliente receber páginas de mensagens posteriores ao próprio delivered_seq; inbox/list metadata sozinha não é receipt. Worker serial por store, sem polling, continua mesmo com painel fechado. Read mantém condição atual de foco/fim do histórico.
- Selected channel recebe INSERT/UPDATE de mensagens e INSERT/UPDATE de reações filtrados por conversa. Inbox continua por participante. Eventos e snapshots usam cancellation sticky e revision de reação para não ressuscitar conteúdo/emoji antigos.
- Reconnect revalida todas as páginas já carregadas, previews de reply e reações; preserva scroll e dedupe. Troca de conversa/workspace invalida callbacks. Sem cache de conteúdo em localStorage.

## UI

Menu discreto no hover/focus e acessível por botão no touch. Quick reactions ❤️ 👍 😂 😮 😢 🙏 e picker já instalado. Composer guarda somente ID do reply; preview resolve no mesmo escopo. Clique localiza/carrega original. Modal de encaminhamento lista contatos válidos do workspace e suporta seleção múltipla. Informações: horário exato de envio, entregue/lida confirmado quando cursor permitir, sem horários individuais inventados. Cancelar exige confirmação e mostra erro específico se read venceu a corrida.

Menus/dialogs usam primitives já instaladas com portal para fullscreenElement/body e camada local do Chat, sem modificar componentes globais, controle de mídia ou janela flutuante. Clipboard API apenas para texto ativo. Sem anexos/calls/grupos/novas dependências.

## Aplicação futura

SQL canônico novo em supabase/staged-migrations/20261015140000_office_chat_interactions.sql. Espelho sem BEGIN/COMMIT em supabase/staged-migrations/drizzle/0004_office_chat_interactions.sql, fora da descoberta automática. Não alterar Drizzle 0000–0003, journal ou SQL do MVP aplicado. Deploy/aplicação exigirão autorização separada. Testes somente PostgreSQL Docker descartável, network none, contas fictícias.
