# Superadmin — desenho implementado, aguardando homologação

**Estado:** fases 1–3 concluídas no banco real conforme confirmação do responsável. Reconciliação staged NÃO aplicada; fases 4–6 pendentes. Nenhum SQL real executado nesta atualização; nenhum merge/publicação.

O manifesto vigente, com nomes finais, SQL completo por arquivo, gates de aplicação e rollback, está em [superadmin-rollout.md](superadmin-rollout.md). `docs/security/proposals/superadmin/01–06` e o draft de hardening são referências históricas: **não aplicar junto das migrations finais**.

## Evidência real e limites

O responsável confirmou: admin=1, master=1, interseção=1, somente_admin/master=0; 1 workspace, 17 members, nenhum admin local, 1 owner canônico e nenhum convite. Não há normalização legada necessária com esse estado. O bootstrap revalida a interseção e o hardening aborta se houver novas inconsistências.

O inventário fornecido confirmou RLS ativo e FORCE RLS falso nas quatro tabelas centrais; helpers SECURITY DEFINER e os caminhos de privilégio descritos no manifesto. O JSON integral não foi anexado nesta conversa. Antes de aplicar, reconferir catálogo/owners/grants contra `00-preflight-readonly.sql`, inclusive owner confiável `postgres` e Auth.deleted_at/banned_until. Fixtures não comprovam configuração do Supabase real.

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

- As seis fases e a reconciliação estão staged, fora da descoberta automática. Infraestrutura e atribuição dependem de execução individual explicitamente autorizada.
- `platform_bootstrap_superadmin()` é service-only, sem identidade por argumento. Confere counts 1/1/1, seleciona a única interseção admin+master ativa e atribui a label explícita. Mudança de inventário aborta. Preserva as labels legadas.
- A interseção é critério apenas dessa inicialização, nunca autorização permanente. Outra conta admin+master não se torna Superadmin.
- Índice parcial limita a uma atribuição de Superadmin, mesmo se o titular ficar inacessível. Recuperação troca essa atribuição em uma transação.
- Triggers bloqueiam remoção/rebaixamento normal, exclusão/soft-delete/ban do titular e TRUNCATE. Senha/perfil continuam pelos fluxos apropriados. Não há botão ou RPC de cliente para atribuir Superadmin.
- `platform_recover_superadmin(replacement uuid)` possui EXECUTE só para service_role. Identidade de recuperação é fornecida na sessão privada, fora do repo. Bloqueia e valida a conta ativa antes de retirar o titular anterior; erro reverte tudo.
- Antes do corte, recuperação transfere também admin/master do titular anterior para o substituto, mantendo acesso ao aplicativo legado. Após o corte, atribui somente Superadmin. Limpa a confirmação/atestação anterior. Essa transferência é recuperação explícita, não promoção automática.
- Auditoria privada guarda ator/alvo/workspace/ação e campos mínimos de role, somente no banco. Sem senhas, tokens, chaves ou conteúdo de chat. Nenhum ID real vai ao código versionado.
- service_role nunca vai ao frontend. Um operador root capaz de remover proteções permanece autoridade confiável; proteção contra acidente não substitui custódia dessa credencial.

## Migrations finais e ordem

Consulte a tabela de fases e reconciliação em [superadmin-rollout.md](superadmin-rollout.md). Ordem: enum → foundation/RPCs → bootstrap privado → reconciliação aprovada da foundation → rollout/homologação da aplicação → confirmação do titular + atestação service-only do commit → memberships/convites → helpers/perfil/gravação → nova homologação → retirada dos overrides globais.

Todos os SQLs canônicos ficam em `supabase/staged-migrations`, fora da descoberta automática. Cada etapa posterior tem transação própria; erro reverte a etapa inteira, preservando as fases anteriores. O enum precisa de commit separado antes de seu uso.

RPCs locais ficam desabilitadas até o hardening, pois antes disso a policy de autoentrada não comprovava a legitimidade do admin local. Não ampliar admin/master durante a janela legada. `platform_acknowledge_superadmin_access` confirma a sessão; `platform_authorize_cutover` registra a homologação do commit pelo operador. O gate mantém lock até COMMIT, impedindo recuperação concorrente durante a etapa. A fase final também inventaria funções por pg_proc/pg_get_functiondef e exige allowlist explícita por assinatura/corpo/configuração/EXECUTE; desconhecidas abortam sem reescrita.

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
| `platform_assign_workspace_member(uuid,uuid,workspace_role,text) → void` | Role + perfil em uma transação |
| `platform_update_workspace(uuid,text,smallint,uuid) → void` | Superadmin; metadados + transferência atômicos |

Existentes alteradas: is_workspace_admin, is_workspace_member, has_role, current_user_email, workspace_accept_invite, workspace_members_guard_profile, can_read_meeting_participants, can_record_meeting. Wrappers públicos permitem ator próprio e membership de colegas do workspace já acessível; roles e capacidades de gravação não enumeram terceiros. PUBLIC/anon perdem EXECUTE; helpers privados continuam inacessíveis. Aceite mantém token, email lock, expiração, usos e capacidade; adiciona validação do emissor ainda autorizado, role member e lock workspace→convite. Convites privilegiados não promovem nesta fase; promoção é operação explícita do Superadmin. Signup removido historicamente permanece fora do escopo, sem recriação.

## Policies/grants afetados segundo o repo

| Objeto | Policies afetadas / resultado |
| --- | --- |
| workspace_members | Substituir Admin or self inserts member, Admin updates members, Self leaves workspace. INSERT só próprio owner canônico operacional; UPDATE revogado; DELETE só saída própria não canônica. SELECT permanece |
| workspaces | Admin creates workspace exige owner_id=self; Admin or owner updates/deletes workspace perdem override global; trigger impede transferência direta |
| workspace_invites | Retirar Admin creates invite / Admin deletes invite e grants de escrita cliente; criação/revogação por RPC, reads preservados |
| map_overrides | Retirar Admin can manage map_overrides; Workspace admin upserts/updates/deletes map ficam locais ou supervisor membro |
| custom_props | Retirar Admin can manage custom_props; Admin inserts/updates/deletes custom_props ficam locais ou supervisor membro |
| sprite_skins | Retirar Admin manages skins e read cross-workspace por admin; catálogo global normal permanece |
| storage.objects | Retirar Admin writes/updates/deletes sprite sheets; upload via handler validado |
| account_groups | Retirar Admins manage groups; a leitura ampla USING(true) fica pendência separada, não corrigida neste pacote |
| map_save_points | Retirar master de members read save points / admins create/delete save points |
| rtc_events | Admins read workspace rtc events fica local; insert/read próprios e runtime RTC preservados |
| meeting_participants | Policy existente usa can_read_meeting_participants ajustada, sem override admin/master; administração global usa servidor |
| user_roles | SELECT próprio preservado; nenhuma escrita cliente nova; TRUNCATE revogado/protegido |

## Guards/UI implementados; rollout separado

- Novo guard central `requireSuperadmin(context)` consulta a role atual por requisição antes de service_role. Não confia em metadata, formulário, nome/e-mail nem role da UI.
- `src/lib/admin/{accounts,workspaces,sprites,ai-sprite}.functions.ts`: substituir quatro ensureAdmin; validar todos os handlers globais. Exclusão/desativação protege qualquer titular Superadmin. Membership/profile/owner transfer usam RPC; criação não faz duas escritas separadas.
- `src/routes/_authenticated/admin.{index,contas,espacos,personagens}.tsx` e botão global de workspaces.index.tsx: novo gate. UI mostra ações, não autoriza o servidor.
- `workspaces.new.tsx` + `src/lib/workspace/create.ts`: separar criação própria elegível da administração global. Superadmin sem labels antigas usa RPC e inicialização de mapa escopada; cópia cross-workspace usa handler global validado.
- `src/components/office/OfficeScene.tsx`: gate isMasterAdmin hoje verifica admin; migrar só autorização visual, preservando Office persistente/overlay real.
- `src/components/office/{MapEditor,MapSavePoints}.tsx` + `src/lib/map-overrides.ts`: disponibilizar handlers globais validados para leitura/edição sem membership. Operações/realtime locais continuam escopados.
- `src/lib/meetings/recording.functions.ts` + `src/components/meetings/MeetingsPanel.tsx`: trocar somente gates globais admin/master. Hoje administradores globais podem acessar gravação pelo servidor sem membership; preservar essa capacidade para Superadmin. Participantes/destinatários normais mantêm membership. Sem mudança de Egress/R2/mídia.
- `src/lib/meetings/record-permission.ts`: adicionar superadmin à capacidade membership-bound em paridade com SQL. Sem auto-join RTC.
- `src/integrations/supabase/types.ts`: contratos locais de enum/RPCs atualizados; confrontar com geração oficial após aplicação em homologação.
- Caminho legado temporário explícito durante transição; no final nenhum guard global usa admin || master. Nenhuma alteração de RTC/RoomManager/Presence/movimento/sessão/Desktop integra este pacote.

## Rollback e testes

O procedimento vigente está em [superadmin-rollout.md](superadmin-rollout.md): transação por etapa, manutenção de infraestrutura aditiva, recuperação service-only e retorno somente a aplicativo compatível com Superadmin. Não remover label do enum nem restaurar autoentrada ou equivalência admin/master.

`PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_superadmin_proposals.py --migrations` testa os arquivos finais em PostgreSQL 16 descartável, sem rede/porta/dados reais. O modo sem flag também usa o pacote staged; propostas históricas não são executadas. `scripts/test_foundation_reconciliation.py` reproduz o histórico Drizzle aplicado em banco descartável. Policies e RPCs legadas vêm do repositório; Auth/Storage/REST são limites de fixtures.

A suite cobre bootstrap exclusivo, singleton, recuperação/concurrência, gates e idempotência; autoentrada/autopromoção negadas, owner_id alheio negado, criação válida, convite válido/inválido/expirado/revogado/privilegiado; local vs global; transações administrativas; integridade de owner; helpers/grants privados; RLS positivo em usuário autenticado após corte. Vitest executa handlers/UI reais com adaptadores de teste nas fronteiras.

Antes de aplicar faltam REST/JWT e Auth admin API em Supabase de homologação; geração oficial dos tipos; exercício de painéis e overlays na composição real, inclusive Superadmin sem membership nem labels antigas; regressão do Office/reuniões e ensaio privado de recuperação. SQL isolado não comprova essas condições nem substitui a confirmação operacional do bootstrap real.
