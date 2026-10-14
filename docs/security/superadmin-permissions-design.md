# Superadmin — desenho final proposto para revisão

**Estado:** SQL proposto e testes isolados. Nada aplicado, mergeado, publicado ou enviado ao GitHub nesta tarefa. Guards/UI ainda não foram implementados. Branch: `codex/workspace-membership-hardening`.

O SQL completo está em `docs/security/proposals/superadmin/`, fora de `supabase/migrations`. O candidato antigo `docs/drafts/workspace-membership-insert-hardening.sql` fica superado; não aplicar junto deste pacote.

## Evidência real e limites

O responsável confirmou a partir do banco real: admin=1, master=1, interseção=1, somente_admin=0, somente_master=0; a conta pretendida é essa interseção. Não armazenar nome, UUID, e-mail ou credenciais no Git.

Essa confirmação não comprova o catálogo real. Owners, grants, SECURITY DEFINER, FORCE RLS e funções/policies adicionais ainda precisam ser confrontados com o repo usando `00-preflight-readonly.sql`. As propostas pressupõem instalação pelo owner confiável `postgres`, capaz de ignorar RLS nas tabelas relevantes. Não alterar owners em lote. Fixtures isoladas não comprovam privilégios do banco real.

## Permissões finais

| Papel | Administração global | Memberships | Promoção/rebaixamento de owner/admin | Transferência de propriedade |
| --- | --- | --- | --- | --- |
| `user_roles.superadmin` | Servidor validado | Qualquer workspace, sem exigir membership | RPC protegida | RPC transacional |
| `workspace_members.owner` | Não | Membros comuns do próprio workspace, por RPC | Não | Não |
| `workspace_members.admin` | Não | Membros comuns do próprio workspace, por RPC | Não | Não |
| Membro comum | Não | Uso normal, convite válido e saída própria não canônica | Não | Não |
| `user_roles.admin/master` | Não após o corte | Só conforme papel local | Não pela label global | Não |
| `user_roles.supervisor` | Não | Delegação operacional limitada a workspace do qual é membro | Não | Não |

Labels antigas permanecem disponíveis. Capacidades **limitadas** existentes podem continuar: admin elegível cria o próprio workspace; admin/master/supervisor já membros podem gravar. Isso não equivale a autoridade de plataforma. `has_role` continua refletindo as labels reais.

A role owner deve concordar com `workspaces.owner_id`. Superadmin pode transferir propriedade e depois remover o antigo owner, mas não deixar workspace sem dono. Integridade, regras de plano/tier e privacidade de mídia continuam válidas; administração não conecta RTC, move avatar ou dá acesso automático a futuras mensagens privadas.

## Atribuição e proteção

- Migrations criam infraestrutura; não atribuem Superadmin automaticamente.
- `platform_bootstrap_superadmin()` é service-only, sem identidade por argumento. Confere counts 1/1/1, seleciona a única interseção admin+master ativa e atribui a label explícita. Mudança de inventário aborta. Preserva as labels legadas.
- A interseção é critério apenas dessa inicialização, nunca autorização permanente. Outra conta admin+master não se torna Superadmin.
- Índice parcial limita a uma atribuição de Superadmin, mesmo se o titular ficar inacessível. Recuperação troca essa atribuição em uma transação.
- Triggers bloqueiam remoção/rebaixamento normal, exclusão/soft-delete/ban do titular e TRUNCATE. Senha/perfil continuam pelos fluxos apropriados. Não há botão ou RPC de cliente para atribuir Superadmin.
- `platform_recover_superadmin(replacement uuid)` possui EXECUTE só para service_role. Identidade de recuperação é fornecida na sessão privada, fora do repo. Bloqueia e valida a conta ativa antes de retirar o titular anterior; erro reverte tudo.
- Antes do corte, recuperação transfere também admin/master do titular anterior para o substituto, mantendo acesso ao aplicativo legado. Após o corte, atribui somente Superadmin. Limpa a confirmação/atestação anterior. Essa transferência é recuperação explícita, não promoção automática.
- Auditoria privada guarda ator/alvo/workspace/ação e campos mínimos de role, somente no banco. Sem senhas, tokens, chaves ou conteúdo de chat. Nenhum ID real vai ao código versionado.
- service_role nunca vai ao frontend. Um operador root capaz de remover proteções permanece autoridade confiável; proteção contra acidente não substitui custódia dessa credencial.

## Migrations propostas: ordem e conteúdo

| Arquivo | Alteração exata |
| --- | --- |
| `00-preflight-readonly.sql` | Somente metadados/contagens; nenhum corpo de função ou dado pessoal no resultado |
| `01-role.sql` | Adiciona superadmin ao enum; COMMIT separado antes de 02 |
| `02-foundation.sql` | Schema/estado/auditoria privados, índice singleton, proteções, check do ator, bootstrap/recovery, confirmação e atestação |
| `03-administration-rpcs.sql` | Roles globais, memberships, perfil, transferência/criação de workspace, criação/revogação de convites validadas |
| `04-membership-cutover.sql` | Fecha autoentrada/promoção/escritas administrativas cliente; protege owner_id; endurece aceite de convites |
| `05-legacy-overrides-cutover.sql` | Retira overrides globais das policies/funções mapeadas; mantém capacidades limitadas e marca corte concluído |
| `06-cutover-transaction.sql` | Wrapper psql para 04+05 na mesma transação; não é comando de produção autorizado |

Sequência de aplicação futura: 01 → 02 → bootstrap privado → 03 → rollout dos guards/UI/handlers → homologação completa → confirmação autenticada → atestação service-only do SHA da aplicação → 04+05 atômicos.

RPCs locais de 03 ficam desabilitadas até 04, pois antes disso um falso admin poderia ter vindo da autoentrada insegura. Não estender labels admin/master a outras contas durante a janela legada; novos handlers devem bloquear isso.

`platform_acknowledge_superadmin_access()` prova a role da sessão, não funcionamento de todos os painéis. `platform_authorize_cutover(application_commit text)` registra uma atestação do operador após homologação do commit completo; só service_role executa. O gate de corte segura lock até COMMIT, excluindo recuperação concorrente.

04 aborta por policies inesperadas, owners não canônicos ou convites privilegiados pendentes. Esses casos exigem correção privada deliberada, sem limpeza em lote. Como a policy antiga permitia autoentrada com qualquer role, também validar privadamente a legitimidade dos admins/owners/estratégicos já armazenados: fechar a policy não prova a origem desses privilégios. A busca final por has_role é defesa adicional, não prova completa de ausência de overrides em funções não inventariadas. Não aplicar antes de confrontar o catálogo real e homologar o aplicativo.

## Funções/RPCs

Todas derivam o ator de `auth.uid()`. UUIDs target/owner/new_owner são alvos, nunca identidade de ator. SECURITY DEFINER: owner confiável, search_path=pg_catalog, objetos qualificados e grants explícitos. Nenhuma policy global nova permite administração Superadmin diretamente no cliente.

| Interface pública | Autorização |
| --- | --- |
| `platform_is_superadmin() → boolean` | Próprio ator, sem actor_id por argumento |
| `platform_bootstrap_superadmin() → jsonb` | Service-only, retorno sem identidade |
| `platform_recover_superadmin(uuid) → jsonb` | Service-only, retorno sem identidade |
| `platform_acknowledge_superadmin_access() → jsonb` | Titular autenticado |
| `platform_authorize_cutover(text) → void` | Operador service-only |
| `platform_set_global_role(uuid, app_role, boolean) → void` | Superadmin, exceto atribuição de superadmin |
| `platform_set_workspace_member(uuid,uuid,workspace_role) → void` | Superadmin global; local só member e alvo não privilegiado |
| `platform_remove_workspace_member(uuid,uuid) → void` | Mesma autorização; owner canônico exige transferência |
| `platform_transfer_workspace_owner(uuid,uuid,workspace_role) → void` | Só Superadmin, atômica |
| `platform_set_member_profile(uuid,uuid,text) → void` | Mesma autorização sobre o alvo |
| `platform_create_workspace(text,text,uuid,smallint) → uuid` | Só Superadmin, workspace + membership owner atômicos |
| `platform_create_workspace_invite(uuid,text,interval) → uuid` | Gestor validado; sempre member |
| `platform_revoke_workspace_invite(uuid) → void` | Gestor validado |

Existentes alteradas: workspace_accept_invite, workspace_members_guard_profile, can_read_meeting_participants, can_record_meeting. Aceite mantém token, email lock, expiração, usos e capacidade; adiciona validação do emissor ainda autorizado, role member e lock workspace→convite. Convites privilegiados não promovem nesta fase; promoção é operação explícita do Superadmin. signup_invite_redeem permanece validando token e criando workspace + owner.

## Policies/grants afetados segundo o repo

| Objeto | Policies afetadas / resultado |
| --- | --- |
| workspace_members | Substituir Admin or self inserts member, Admin updates members, Self leaves workspace. INSERT só próprio owner canônico operacional; UPDATE revogado; DELETE só saída própria não canônica. SELECT permanece |
| workspaces | Admin creates workspace exige owner_id=self; Admin or owner updates/deletes workspace perdem override global; trigger impede transferência direta |
| workspace_invites | Retirar Admin creates invite / Admin deletes invite e grants de escrita cliente; criação/revogação por RPC, reads preservados |
| signup_invites | Retirar Admins manage signup invites e grants de escrita cliente; emissão pelo servidor; redeem preservado |
| map_overrides | Retirar Admin can manage map_overrides; Workspace admin upserts/updates/deletes map ficam locais ou supervisor membro |
| custom_props | Retirar Admin can manage custom_props; Admin inserts/updates/deletes custom_props ficam locais ou supervisor membro |
| sprite_skins | Retirar Admin manages skins e read cross-workspace por admin; catálogo global normal permanece |
| storage.objects | Retirar Admin writes/updates/deletes sprite sheets; upload via handler validado |
| account_groups | Retirar Admins manage groups; a leitura ampla USING(true) fica pendência separada, não corrigida neste pacote |
| map_save_points | Retirar master de members read save points / admins create/delete save points |
| rtc_events | Admins read workspace rtc events fica local; insert/read próprios e runtime RTC preservados |
| meeting_participants | Policy existente usa can_read_meeting_participants ajustada, sem override admin/master; administração global usa servidor |
| user_roles | SELECT próprio preservado; nenhuma escrita cliente nova; TRUNCATE revogado/protegido |

## Guards/UI afetados no rollout separado

- Novo guard central `requireSuperadmin(context)` consulta a role atual por requisição antes de service_role. Não confia em metadata, formulário, nome/e-mail nem role da UI.
- `src/lib/admin/{accounts,workspaces,sprites,ai-sprite}.functions.ts`: substituir quatro ensureAdmin; validar todos os handlers globais. Exclusão/desativação protege qualquer titular Superadmin. Membership/profile/owner transfer usam RPC; criação não faz duas escritas separadas.
- `src/routes/_authenticated/admin.{index,contas,espacos,personagens}.tsx` e botão global de workspaces.index.tsx: novo gate. UI mostra ações, não autoriza o servidor.
- `workspaces.new.tsx` + `src/lib/workspace/create.ts`: separar criação própria elegível da administração global. Superadmin sem labels antigas usa RPC e inicialização de mapa escopada; cópia cross-workspace usa handler global validado.
- `src/components/office/OfficeScene.tsx`: gate isMasterAdmin hoje verifica admin; migrar só autorização visual, preservando Office persistente/overlay real.
- `src/components/office/{MapEditor,MapSavePoints}.tsx` + `src/lib/map-overrides.ts`: disponibilizar handlers globais validados para leitura/edição sem membership. Operações/realtime locais continuam escopados.
- Emissão de signup invites precisa de handler Superadmin antes de retirar escrita cliente; verificar também clientes fora deste repo.
- `src/lib/meetings/recording.functions.ts` + `src/components/meetings/MeetingsPanel.tsx`: trocar somente gates globais admin/master. Hoje administradores globais podem acessar gravação pelo servidor sem membership; preservar essa capacidade para Superadmin. Participantes/destinatários normais mantêm membership. Sem mudança de Egress/R2/mídia.
- `src/lib/meetings/record-permission.ts`: adicionar superadmin à capacidade membership-bound em paridade com SQL. Sem auto-join RTC.
- `src/integrations/supabase/types.ts`: regenerar enum/RPCs.
- Caminho legado temporário explícito durante transição; no final nenhum guard global usa admin || master. Nenhuma alteração de RTC/RoomManager/Presence/movimento/sessão/Desktop integra este pacote.

## Rollback

1. Antes do corte: interromper rollout; roles/policies legadas continuam. Manter infraestrutura aditiva; não apagar Superadmin/proteções nem tentar remover valor de enum. Recuperação de conta via service-only.
2. Erro em 04+05: rollback automático da transação inteira. Policies antigas permanecem e RPCs locais não são ativadas parcialmente.
3. Após o corte: voltar a commit de aplicação já compatível com Superadmin, manter hardening e corrigir para frente. Recuperação continua service-only. Nunca reabrir autoentrada nem equivalência automática admin/master.
4. Versão antiga que só conhece admin não é rollback automático seguro. Se indispensável, preparar compatibilidade server-side limitada ao Superadmin real, com revisão própria. Restaurar policies antigas seria enfraquecimento explícito, fora deste procedimento.

Antes de executar: guardar commit de aplicação/SQL, backup privado do catálogo/dados, testes e confirmação do caminho de recuperação. Backups/IDs privados nunca são artifacts públicos.

## Testes e limites

`PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_superadmin_proposals.py` executa todo o SQL proposto em PostgreSQL 16 descartável, sem network/porta/credenciais reais. Policies e RPCs originais vêm das migrations; Auth/Storage têm fixtures fictícias de schema, não serviços Supabase reais.

Verificação desta preparação (2026-10-14): **90 asserções passaram**, incluindo dois cenários concorrentes e rollback de 04 quando 05 falha. O schema original, sem as propostas, falha por ausência do guard novo. Revisão independente encontrou riscos de concorrência, TRUNCATE e inicialização via recovery; foram corrigidos e cobertos por testes.

Cobre bootstrap exclusivo, counts divergentes, ausência de promoção automática, singleton, proteção delete/demotion/ban/TRUNCATE, recuperação antes/depois do corte, gates, concorrência com ban e corte, autoentrada/autopromoção, owner_id falso, criação legítima, local vs global, RPC vs cliente, convites válidos/inválidos/expirados/revogados/exauridos/email incorreto/privilegiados, transferência atômica e erro de plano, signup válido, grants/auditoria e remoção de override de mapa/storage.

Faltam antes da aplicação: catálogo/owners/grants reais, REST/JWT em Supabase de homologação, Auth admin API com trigger protetor, guards/UI/tipos implementados, homologação de todas as ações e overlays na composição real, regressão funcional do Office/reuniões. Testes SQL isolados não comprovam esses fluxos. Nenhuma aplicação em produção autorizada por este documento.
