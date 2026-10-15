# Chat privado 1:1 — MVP preparado

Base exata: `c29f9bb37b406179c133cfd7058b2db0fc89b162`. Branch: `codex/office-chat-mvp`. Nenhum SQL real foi executado; nenhum merge ou publicação. A branch de segurança e seu pacote permanecem intactos.

## Banco: revisão e aplicação isolada futura

SQL completo: [20261014220000_office_chat_mvp.sql](../../supabase/staged-migrations/20261014220000_office_chat_mvp.sql). **Staged, NÃO aplicada**, fora da descoberta automática. Não executar db push, drizzle migrate/push/generate ou outras migrations deste diretório. Somente após autorização separada, aplicar este arquivo integralmente como postgres confiável em transação única, com backup privado e ambiente confirmado. Ele não executa Superadmin/reconciliação/fases 4–6.

Inventário foi somente dos tipos/migrations/código versionados: não havia chat. Não se consultou o banco real. Se tabelas/funções de mesmo nome já existirem, CREATE aborta para revisão; não há DROP/CREATE OR REPLACE de objetos desconhecidos. Exige publicação Supabase Realtime existente; falha reverte todos os novos objetos. Em erro, parar; ROLLBACK se a sessão permanecer abortada. Depois do commit não apagar tabelas com mensagens automaticamente: avaliar backup/correção para frente e retenção com o responsável.

Duas tabelas:

| Tabela | Dados e integridade |
| --- | --- |
| chat_conversations | Workspace e participantes ordenados a<b; UNIQUE(workspace,a,b). Datas de criação/atualização/última mensagem, seq da última e dois marcadores próprios de leitura. Índices de inbox A/B. |
| chat_messages | UUID idempotente, conversation_id, sender_id, body, message_type text/sticker, seq crescente por conversa e data do servidor. UNIQUE(conversation_id,seq). |

Estado de leitura não exige terceira tabela para 1:1. Unread conta mensagens do outro participante acima do marcador do ator. Read só avança; marca no máximo o seq carregado. Não há recibo/duplo check na interface. Texto Unicode até 4000 caracteres; quatro stickers locais hello/thanks/coffee/celebrate, sem URLs arbitrárias, upload, HTML ou mídia. Persistência não usa Storage nem LiveKit.

FKs fazem cascade quando a conta ou o workspace é excluído pelo fluxo administrativo já existente: as conversas relacionadas são apagadas. Remoção de membership apenas bloqueia leitura/envio enquanto qualquer participante não for mais membro; não altera nem apaga memberships. Não há ação de editar/apagar mensagens neste MVP. Retenção após exclusão de conta seria decisão/feature separada.

## RLS e RPCs

Policies novas somente SELECT, TO authenticated:

- `Chat participants read conversations`: ator é A/B e ambos ainda são membros do workspace.
- `Chat participants read messages`: mesma autorização pela conversa.

Nenhuma policy de leitura global para Superadmin. Sem INSERT/UPDATE/DELETE cliente; grants escritos revogados explicitamente de PUBLIC/anon/authenticated/service_role e SELECT concedido a authenticated. RPCs têm EXECUTE somente authenticated, owner postgres e search_path pg_catalog. Nenhum novo acesso ao schema platform_private.

| Função | Contrato |
| --- | --- |
| chat_start_conversation(ws,peer) | Deriva ator de auth.uid, valida os dois memberships e retorna único par por workspace, inclusive criação reversa/concorrente. |
| chat_send_message(cid,content,kind,message_id) | Sem sender_id por parâmetro. Deriva remetente, valida texto/sticker, serializa sequência/data após lock. Retry idêntico retorna mesma mensagem; colisão incompatível falha sem revelar conteúdo. |
| chat_mark_read(cid,through_seq) | Atualiza só marcador do ator; não regride, não consome chegada posterior ao cursor visto. |
| chat_list_conversations(ws) | Somente inbox do ator, metadata mínima do colega, preview e unread, ordenados por mensagem recente. |
| chat_can_access_conversation(cid) | Helper RLS booleano, sem identidade arbitrária ou override global. |
| chat_lock_conversation(cid) | Interna, EXECUTE negado a todos os clientes. Locks workspace→memberships em ordem UUID→conversa. |

Os helpers de Chat consultam memberships diretamente. **Limite conhecido:** a policy legada de autoentrada em workspace continua aberta antes do hardening separado. Ela permite transformar indevidamente um não membro em membro e iniciar uma nova conversa; isso não oferece leitura de conversas de terceiros. Este MVP não corrige essa pendência por instrução explícita. Não tratar este trabalho como conclusão do hardening da plataforma.

Tipos Supabase foram estendidos só para as novas tabelas/RPCs; nenhuma regeneração ampla ou cast any para schema inexistente. Regerar/conferir esses contratos com o banco depois da aplicação autorizada.

## Realtime e recuperação

Uma assinatura inbox por usuário/workspace, com quatro handlers INSERT/UPDATE filtrados por participant_a=uid ou participant_b=uid. Nenhuma assinatura global de chat_messages/workspace. Payload de outro workspace é ignorado; autorização real continua RLS, não o nome do canal.

Uma assinatura de mensagens da conversa selecionada: conversation_id=cid. Ela permanece única ao fechar/reabrir o painel e é substituída ao trocar conversa. Topics únicos evitam reutilizar canal em encerramento assíncrono em A→B→A; callbacks são invalidados imediatamente no cleanup. Ao sair do workspace, provider descarta store/listeners/notificações. Respostas de requisições antigas não atravessam conversa/usuário/workspace.

Snapshots após subscribe/reconnect recuperam eventos perdidos sem descartar páginas antigas ou a intenção de scroll. Buscam páginas intermediárias até fechar lacunas de sequência, inclusive quando um evento novo já chegou além da lacuna; em falha, preservam o histórico e suspendem leitura automática até reconciliar. Mensagens são mescladas por id/seq, sem duplicação. Não há polling permanente. Paginação keyset exclusiva por seq, 40 mensagens + sentinela por página, sem offset/relógio do browser. Retry mantém o UUID de cada payload com resultado desconhecido, inclusive texto retido após envio de outro sticker; somente a confirmação do mesmo envio libera sua identidade. Mensagens não lidas persistem no banco.

## Composição e notificações

`OfficeChat` envolve o mesmo OfficeScene persistente, não o substitui. `?panel=chat` abre painel irmão; menu real do avatar tem Enviar mensagem e topbar tem Mensagens/contador. Lista, nome, SpriteAvatar, preview, texto, emojis/stickers e histórico incremental usam o design existente.

Abrir/fechar/ESC/Back não libera sessão nem muda Room/zona/Presence. O input de movimento é suspenso como nos demais overlays; fechar restaura a regra existente. **Não há caminhada com painel aberto neste MVP**, para preservar a invariante de teclado e evitar movimento ao digitar. Não se alteraram RTC, dispositivos, proximidade, share, Privacy Guard ou gravação.

O painel usa host de fullscreen quando presente e a camada normal dos painéis do Office. Apresentação/screen-share possuem camadas próprias superiores; voltar à visualização do Office dá acesso ao chat. Não se elevou o chat sobre controles/convites nem se mudou a hierarquia de mídia. Homologar esses fluxos na composição real antes de publicar.

Notificação entregue neste MVP: toast interno genérico, sem corpo privado, e contador persistente. Não avisa sobre a própria mensagem, duplicatas ou conversa visível no fim do histórico. Não marca leitura enquanto janela está oculta/sem foco ou usuário lê mensagens antigas. Alertas em background aguardam foreground. Clique só abre a conversa.

`OfficeNotificationService.notifyChat?` é capacidade opcional preparada para futuro. Não há fallback para notify de join-request. **Adapters Web/Desktop, Service Worker, IPC e EXE não foram modificados. Não há notificação nativa de chat implementada aqui**, nem necessidade de novo EXE para a interface web do MVP. Ativar essa capacidade exigirá homologação específica posterior; não reusar a bridge de join com tags não suportadas.

Se a migration ainda não existir, o chat apresenta indisponibilidade amigável e mantém Office/calls funcionando. Nenhum retry automático de SQL ou aplicação de migrations ocorre.

## Validação e homologação

Comandos locais: `PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_office_chat.py`, `npm test`, `npx tsc --noEmit`, `npm run build`. PostgreSQL16 descartável, sem rede/porta/credenciais; schema legado carregado como fixture, sem executar migrations staged de segurança. Realtime unitário usa a fronteira do SDK substituída. O teste de OfficeScene monta componentes reais de Office/Chat/Router, substituindo somente I/O de Auth/DB/mídia.

Depois da autorização separada de SQL, homologar com duas contas reais do mesmo workspace: texto, Unicode/sticker, inbox em ambos, foreground/background, leitura/scroll/paginação, queda/reconexão, trocar conversa rapidamente, reabrir e reiniciar app. Com uma terceira conta e outro workspace, confirmar leituras/escritas negadas, inclusive Superadmin não participante. Conferir Supabase publication/Postgres Changes/RLS usando JWT reais.

Validar Office/call real durante painel: mesma sessão/avatar/Room/Presence, nenhum novo join/leave, nenhuma alteração de mic/cam/share/gravação. Testar ESC/Back, perfil/reuniões, apresentação/retorno Office/fullscreen, desktop instalado e sobreposição de convites/celebrações. Automatizados não comprovam entrega real no Supabase/Windows nem autorizam publicação.

Verificação local: 678 testes Vitest em 63 arquivos, typecheck e build aprovados; 46 asserções SQL e dois checks do harness (preservação do catálogo e rollback sem publication), em PostgreSQL16 isolado. Inclui par único/envio concorrente e timestamp em ordem de serialização. Build conserva avisos de depreciação/chunks já existentes. Não houve validação remota nem publicação.

## Arquivos do pacote

Novos: `src/lib/chat/{types,api,realtime,store,notifications,stickers}.ts`; `src/lib/chat/__tests__/{api,realtime,store,notifications}.test.ts`; `src/components/chat/{OfficeChat,ChatPanel,ChatThread}.tsx`; `src/components/chat/{OfficeChat.test,OfficeChat.scene.test}.tsx`; a migration staged acima; `supabase/tests/office-chat/authorization.sql`; `scripts/test_office_chat.py`; este documento e os dois documentos de desenho/plano em `docs/superpowers/{specs,plans}/2026-10-14-office-chat-mvp*.md`.

Existentes alterados somente para integração: `src/components/office/OfficeScene.tsx` (menu/topbar/context), `src/routes/_authenticated/workspaces.$workspaceId.tsx` (provider e ESC), `src/lib/office/overlay.ts` (tipo chat), `src/lib/notifications/notification-service.ts` (capacidade opcional futura), `src/integrations/supabase/types.ts` (contratos novos do Chat). Nenhuma dependência ou lockfile alterado.
