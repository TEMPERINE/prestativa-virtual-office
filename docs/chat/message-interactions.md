# Chat 1:1 — interações de mensagem

Implementação preparada na branch `codex/office-chat-mvp`, sobre `b4a86f3a1594e40d8f5772a5a8c520972521ce6e`. Nenhuma migration desta etapa foi aplicada ao banco real. Sem publicação, merge, alteração de Superadmin, membership hardening, RTC, Presence ou mídia.

## SQL preparado e ordem futura

- Canônico: [`20261015140000_office_chat_interactions.sql`](../../supabase/staged-migrations/20261015140000_office_chat_interactions.sql), **staged**.
- Espelho compatível com o executor Drizzle/Lovable: [`0004_office_chat_interactions.sql`](../../supabase/staged-migrations/drizzle/0004_office_chat_interactions.sql), também **staged**, fora de `drizzle/migrations` e do journal. A única diferença é a ausência do `BEGIN`/`COMMIT` externo. Não executar ambos.
- Requer o Chat MVP instalado. Não reaplicar o MVP nem executar migrations staged em lote. O SQL aborta se não houver contexto SQL confiável `postgres`, MVP ou publicação Realtime esperados. Não é uma migration para reaplicação: novas colunas/tabela impedem execução duplicada.
- Uma futura aplicação exige autorização própria, revisão deste SQL e transação controlada. Não ativar automaticamente outras etapas de segurança. Após aplicar, verificar contratos/ACLs/publicação, recarregar os clientes atualizados e homologar com duas contas antes de publicar.

O frontend negocia `chat_list_conversations_v2`. Se a RPC não existir, mantém o MVP com envio, histórico e leitura legados; ações que dependem do novo banco ficam desativadas. Falhas de autorização/rede não são confundidas com ausência da RPC. Após aplicar SQL numa sessão que detectou o MVP, recarregar o Office para renegociar a capacidade. Clientes antigos continuam com as assinaturas legadas de envio/leitura, mas **não renderizam integralmente metadados e cancelamentos novos**; coordenar atualização dos clientes para homologação. Não prometer recall de conteúdo já visto por uma versão antiga.

## Modelo e autorização

- `chat_conversations`: `participant_a_delivered_seq`, `participant_b_delivered_seq`. Inicialização a partir de `read_seq`, nunca de `last_message_seq`. Constraints impõem `read <= delivered <= last_message_seq`.
- `chat_messages`: `reply_to_message_id`, `is_forwarded`, `cancelled_at`, `deleted_at`; `body` admite NULL somente em tombstone de cancelamento ou exclusão, mutuamente exclusivos. FK composta impede resposta a outra conversa. Não há referência de origem em encaminhamentos.
- `chat_message_reactions`: chave `(message_id,user_id)`, conversa e FK composta, emoji, criação e revisão monotônica. Remover reação guarda emoji NULL para propagar UPDATE filtrado por conversa, em vez de DELETE sem filtro seguro. Só uma reação ativa por usuário/mensagem.
- RLS de reações: somente SELECT para participantes válidos da conversa, pelo helper existente. `authenticated` recebe SELECT e nenhuma escrita direta. Sem policy de escrita. Sem acesso automático de Superadmin às mensagens.
- RPCs novas `chat_send_message_v2`, `chat_mark_delivered`, `chat_set_reaction`, `chat_cancel_message`, `chat_delete_message`, `chat_forward_message`, `chat_list_conversations_v2`, `chat_list_contacts`: EXECUTE somente `authenticated`, além do owner SQL confiável; `SECURITY DEFINER` com `search_path=pg_catalog`. Identidade de escrita sempre `auth.uid()`, memberships e escopo validados no servidor.
- `chat_insert_message` é writer interno, não executável por `PUBLIC`, `anon`, `authenticated` ou `service_role`. `chat_lock_conversation` mantém o contrato e restrição anteriores. Substituídas apenas as RPCs legadas `chat_send_message` (wrapper compatível) e `chat_mark_read` (também confirma entrega). Nenhuma policy antiga substituída.
- Realtime: somente a tabela de reações é adicionada à publicação existente. Canais de mensagens/reação filtrados por conversa; inbox continua com escopo do usuário. Sem polling ou nova conexão global.

## Receipts, cancelamento e concorrência

`sent` significa row confirmada pelo servidor. O worker de entrega recebe páginas reais, contíguas, de mensagens e só então confirma seu cursor pela RPC; não confirma entrega apenas pelo resumo do inbox. Funciona também com conversa fechada e após reconexão. A UI deriva dos cursores persistidos do destinatário: ✓ cinza para enviada, ✓✓ cinza para entregue e ✓✓ azul para lida, mantendo aria-label/title. Azul `blue-700` sobre branco no claro; `blue-400` sobre `slate-950` no escuro. A área dos ícones tem fundo neutro explícito para não depender do contraste da bolha própria. Leitura mantém as regras de foco, visibilidade e últimas mensagens, suspensa enquanto menus/diálogos de ações cobrem a conversa. Informações mostram horário real de envio e confirmação de entrega/leitura, sem inventar horários individuais.

Cancelar e marcar leitura adquirem o mesmo lock da conversa. Se a leitura venceu, retorna `PCH01`, apresentado como “Não é mais possível cancelar esta mensagem porque ela já foi lida.” Se o cancelamento venceu, `body` vira NULL e reações são invalidadas na mesma transação. Cancelar é idempotente, exclusivo do remetente e permitido após entrega enquanto não lida. Conteúdo cancelado não pode ser reagido, respondido ou encaminhado pelo servidor (`PCH02`). Copy e ações equivalentes são ocultados na UI. Reconciliadores preservam tombstones mesmo diante de snapshots atrasados, incluindo previews de respostas. Metadados de cancelamento/exclusão permanecem em memória por conversa durante a vida do store do workspace, mesmo fora das páginas carregadas ou após trocar de conversa; nenhuma resposta atrasada publica plaintext antes da normalização. O mapa é descartado com o store e não contém o corpo.

Encaminhar copia apenas texto/sticker permitido, cria row por destinatário pelo ator atual e marca `is_forwarded=true`, sem reply/origem/autor anterior. Locks de conversas ordenados evitam deadlock entre encaminhamentos opostos. IDs estáveis por destino permitem repetir uma falha parcial sem duplicar mensagens durante a operação aberta. Fechar o diálogo encerra esse contexto de retry; uma nova operação intencional cria novas mensagens.

## Refinamento: Cancelar envio × Apagar mensagem

A migration incremental 0004 continua **não aplicada**, por isso `deleted_at` e `chat_delete_message(cid,message_id)` foram incorporados ao mesmo SQL canônico e ao espelho staged, sem nova etapa de aplicação. Não executar versões antigas desse arquivo após revisar o novo commit.

| Condição da mensagem própria | Ação | Validação no servidor | Aviso preservado |
| --- | --- | --- | --- |
| `peer_read_seq < seq` | Cancelar envio | lock da conversa, não lida, somente sender | Você cancelou esta mensagem / Esta mensagem foi cancelada |
| `peer_read_seq >= seq` | Apagar mensagem | mesmo lock, já lida, somente sender | Você apagou esta mensagem / Mensagem apagada |

`chat_delete_message` retorna `PCH03` se ainda não lida e não altera a row nesse caso. Repetir exclusão já concluída é idempotente. Não converte cancelamento em exclusão nem exclusão em cancelamento. Ambas as operações removem body e invalidam reações, conservando identidade, sequência, criação, referência de resposta e o timestamp da operação correspondente. Nenhuma faz hard DELETE. Replies usam “Mensagem apagada” ou “Mensagem cancelada”, sem copiar corpo. RPCs de reação, reply e forward rejeitam ambos os tombstones. Informações permanece acessível ao remetente.

O teste concorrente de leitura/exclusão segura o lock de uma leitura ainda não commitada; a exclusão espera e usa o cursor confirmado após o commit. A reconciliação compartilha o mecanismo existente de tombstones, preservando a distinção dos dois campos e bloqueando plaintext atrasado no histórico, lookup, Realtime e delivery após trocar de conversa. O executor remoto, Superadmin e o banco real não foram alterados.

## Interface e persistência

`ChatMessageItem`, `MessageActions` e `ChatMessageDialogs` dividem bolha, menu, confirmação, encaminhamento e informações. `MessageReactionBar` usa Popover ancorado à própria bolha, com seis reações rápidas e botão + para o picker completo; não abre modal inicialmente. A seleção fecha a barra e persiste pela RPC; erros continuam visíveis no Chat. O badge sobreposto à borda inferior agrupa emojis e total; clicar na própria reação remove, em outra substitui. `ChatThread` mantém composer/IME/paginação e acrescenta resposta e busca segura do original. Menus e diálogos usam o mesmo host fullscreen do painel. Botão de ações aparece por hover/foco no desktop e fica acessível por toque. O seletor existente de emojis é reaproveitado; nenhuma dependência nova.

`ChatPanel` preserva arraste, pointer capture, clamp e posição visual. Nenhum conteúdo de mensagens, reação, cursor, destinatário ou estado de convite é persistido em storage. Apenas a posição visual já existente `{x,y}` continua no localStorage. `OfficeScene`, movimento, Presence, RTC, gravação, notificações e bridge Electron não foram alterados.

## Testes e homologação

Automação: suites Chat e Vitest completas, typecheck, build, `npm ci`, Bun frozen lockfile e `scripts/test_office_chat.py --interactions`. A suite SQL roda PostgreSQL descartável, sem rede, aplica o MVP e o incremental **somente nesse ambiente**, valida RLS/RPCs/constraints e corridas de leitura/cancelamento/encaminhamento, e compara fingerprints de objetos fora do Chat. Testes de UI usam os componentes reais, incluindo OfficeScene e os portais de ações.

Homologação ainda necessária após aplicação autorizada do SQL:

1. Duas contas membros no mesmo workspace: enviar texto/sticker, alternar foco e fechar/reabrir Chat; confirmar enviado/entregue/lido sem ler uma conversa fechada. Reconectar com mais de uma página pendente.
2. Adicionar/trocar/remover reações de ambos os lados; reconectar e conferir deduplicação. Responder texto/sticker, paginar e clicar no preview para localizar o original.
3. Encaminhar para múltiplos contatos e repetir somente falhas; destino não vê origem/autor anterior. Copiar texto no navegador/EXE com permissão de clipboard.
4. Cancelar mensagem entregue mas não lida; apagar mensagem própria já lida e conferir row preservada, reação invalidada e preview “Mensagem apagada”; ambos veem o aviso e não o corpo/reação. Disputar leitura/cancelamento com duas contas; se leitura venceu, exibir erro específico sem alterar conteúdo. Destinatário não pode cancelar mensagem alheia.
5. Menus/diálogos com Chat arrastado, fullscreen, tela pequena, textarea/IME e Office em reunião; abrir/fechar não desmonta cena nem move avatar.
6. Terceira conta sem participação (inclusive privilégio global) não lê/reage/modifica a conversa. Remover membership invalida acesso pelas verificações existentes.

Verificação final do refinamento sobre `ca78e8fc7b00a26fd47588eeb434768f2107a59a`: **767/767 Vitest**, incluindo **126/126 Chat**; **105 asserções SQL**, além dos testes concorrentes; typecheck, build, `npm ci` e Bun frozen passaram. Os contratos Supabase fora do Chat, SQL MVP/Drizzle aplicados, mídia, Office e hook de arraste permanecem intactos. A revisão independente encontrou uma falha de reconciliação de cancelamentos fora das páginas carregadas; corrigida com três regressões RED→GREEN (paginação atrasada, lookup atrasado e entrega após troca de conversa). Na revisão do refinamento, foi corrigido também o descarte de uma confirmação autoritativa de cancelar/apagar após trocar de conversa: quatro regressões RED→GREEN provam que o tombstone permanece por cid/id sem modificar outra conversa visível. O relato do modelo foi corrigido para incluir `deleted_at`. Sem achados bloqueantes pendentes. Os testes locais não substituem a homologação no Supabase e nos navegadores/EXE reais.

## Limites e rollback

Delivered confirma recepção pelo cliente, não que a pessoa olhou para a tela; read segue as condições de UI existentes, não prova humana de leitura. Não há timestamps individuais de entrega/leitura. Copiar ou encaminhar cria cópias independentes que não podem ser recolhidas quando o original é cancelado. Cancelamento/exclusão remove conteúdo da leitura normal; não é promessa de eliminação de backups/WAL ou de dispositivos que já o receberam.

Rollback recomendado: antes da aplicação, basta não ativar o SQL. Depois de aplicada, preservar schema aditivo e rows; corrigir progressivamente e restringir acesso temporariamente se necessário. Reverter frontend exige avaliar tombstones NULL e metadados: clientes MVP antigos não oferecem a mesma experiência de cancelamento. Não tentar restaurar `body NOT NULL`, apagar reações/metadata nem recuperar conteúdo cancelado automaticamente. Qualquer SQL de rollback destrutivo exige plano separado e autorização. As verificações de segurança de workspace herdadas permanecem fora deste rollout.
