# Superadmin: pacote executável e gates de aplicação

Preparado em 14/10/2026 na branch `codex/workspace-membership-hardening`. **Não aplicado no banco real, publicado, mergeado ou enviado ao GitHub nesta tarefa.** A autorização atual cobre preparação local e testes isolados. Execução de qualquer etapa no banco real depende de autorização explícita.

## Arquivos finais e ordem

| Ordem | Migration / SQL completo | Alterações |
| --- | --- | --- |
| 1 | [20261014120000_superadmin_role.sql](../../supabase/staged-migrations/20261014120000_superadmin_role.sql) | Adiciona `superadmin` ao enum `app_role`, sem atribuições. Commit separado antes do uso do valor. |
| 2 | [20261014120100_superadmin_foundation_and_rpcs.sql](../../supabase/staged-migrations/20261014120100_superadmin_foundation_and_rpcs.sql) | Estado/auditoria privados, singleton, proteções do titular, bootstrap/recuperação, helpers privados, RPCs administrativas e gates. Não retira overrides legados. |
| 3 | [20261014120200_superadmin_bootstrap.sql](../../supabase/staged-migrations/20261014120200_superadmin_bootstrap.sql) | Atribui somente à única interseção ativa `admin + master`, revalidando counts 1/1/1. Mantém admin/master. Não contém identidade pessoal. |
| **Gate A** | Aplicação nova + homologação | Reconhecer Superadmin e validar acesso global sem membership/labels antigas. Confirmar sessão com `platform_acknowledge_superadmin_access()` e atestar SHA de 40 caracteres via `platform_authorize_cutover(text)`, service-only. |
| 4 | [20261014120300_workspace_membership_hardening.sql](../../supabase/staged-migrations/20261014120300_workspace_membership_hardening.sql) | Fecha autoentrada/autopromoção, protege owner canônico, restringe convites a member e valida aceite. Retém overrides globais legados. |
| 5 | [20261014120400_authorization_helpers_and_recording.sql](../../supabase/staged-migrations/20261014120400_authorization_helpers_and_recording.sql) | Restringe wrappers públicos/EXECUTE; atualiza perfil e capacidade de gravação; separa consulta de cliente de autorização interna. |
| **Gate B** | Homologação após hardening | Validar operações globais e locais, convites, transferência, gravações e overlays reais. Reconfirmar titular/commit se houver recuperação ou alteração do aplicativo. |
| 6 | [20261014120500_retire_legacy_global_overrides.sql](../../supabase/staged-migrations/20261014120500_retire_legacy_global_overrides.sql) | Remove equivalência administrativa global de admin/master nas policies/funções mapeadas. Exige fases 4/5 e gate válido. Aborta por policy residual, função desconhecida com literal admin/master ou divergência na allowlist de funções. |

**As seis etapas estão em `supabase/staged-migrations`, fora da descoberta automática.** Não copiar/aplicar todas de uma vez. Cada arquivo deve ser incorporado/executado individualmente somente na etapa explicitamente autorizada e registrado pelo operador no histórico. 2–6 têm `BEGIN/COMMIT`; 1 é uma DDL aditiva que precisa de commit separado antes de usar o novo enum. Os arquivos históricos `docs/security/proposals/superadmin/01–06` e o draft antigo ficam superados; não executar junto deste pacote.

O Gate B é uma aprovação operacional adicional; o banco verifica os flags/atestação, mas não consegue comprovar que a interface foi homologada. Não executar a fase 6 apenas porque a chamada SQL aceita.

Antes de aplicar, repetir preflight somente leitura e guardar backup privado do catálogo/dados. Confirmar owner confiável `postgres`, bypass RLS, colunas Auth e grants efetivos. O inventário reportado tem 1 workspace/17 members/1 owner canônico/0 admins locais/0 convites: não há limpeza automática. Se o estado mudar, os SQLs abortam em vez de normalizar dados silenciosamente.

## Hierarquia e autorização

- `user_roles.superadmin`: único titular, autoridade global por RPC/handler autenticado, independente de membership; promoções/rebaixamentos e transferência de propriedade reservados a ele.
- `workspace_members.owner/admin`: gestores locais; RPCs permitem apenas administrar membros comuns do próprio workspace, sem promover a owner/admin ou alterar o Superadmin.
- Membro: acesso normal; aceita convite validado como member; pode sair de workspace que não possui. Owner canônico exige transferência antes de saída/remoção.
- `user_roles.admin/master`: labels preservadas, sem equivalência a Superadmin após a fase 6. Mantêm apenas capacidades limitadas previstas no desenho: admin elegível cria o próprio workspace; gravação continua limitada a membership. Supervisor permanece operacional, sem autoridade de plataforma.
- Nenhum convite atribui role global. `workspace_invites_member_only` também bloqueia owner/admin em escrita direta de serviço; promoção exige RPC explícita. Índice `workspace_members_one_owner` e trigger canônico mantêm único owner compatível com `owner_id`.

Todas as RPCs administrativas usam `auth.uid()` como ator. IDs recebidos são alvos, nunca identidade de quem executa. SECURITY DEFINER usa `search_path=pg_catalog`, objetos qualificados, owner confiável e EXECUTE explícito. UI não autoriza; o servidor consulta Superadmin por requisição antes de acessar service role. Não há nova policy ampla Superadmin.

## Funções e triggers afetados

**Novas públicas:** `platform_is_superadmin`, `platform_bootstrap_superadmin`, `platform_recover_superadmin`, `platform_acknowledge_superadmin_access`, `platform_authorize_cutover`, `platform_set_global_role`, `platform_set_workspace_member`, `platform_remove_workspace_member`, `platform_set_member_profile`, `platform_assign_workspace_member`, `platform_create_workspace`, `platform_update_workspace`, `platform_transfer_workspace_owner`, `platform_create_workspace_invite`, `platform_revoke_workspace_invite`.

Bootstrap/recuperação/atestação: EXECUTE apenas service_role, além do owner SQL confiável. Demais RPCs: authenticated e validação de ator; sem PUBLIC/anon. RPCs locais só habilitam gestores após hardening. Role+perfil e metadados+transferência são operações compostas atômicas.

**Substituídas:** `is_workspace_admin`, `is_workspace_member`, `has_role`, `current_user_email`, `workspace_accept_invite`, `workspace_members_guard_profile`, `can_record_meeting`, `can_read_meeting_participants`. Helpers públicos preservam checagem própria e consulta de colegas do workspace já acessível; impedem enumeração anônima/fora do escopo. `has_role` e capacidade de gravação consultam somente o próprio ator ou contexto de serviço confiável. EXECUTE anon/PUBLIC revogado; authenticated/service_role mantidos quando necessário.

**Triggers novos:** proteção de atribuição/conta/truncate Superadmin; proteção de `workspaces.owner_id`; proteção de membership owner canônico. Exclusão legítima do workspace ainda permite cascade. Helpers privados não têm USAGE/EXECUTE para clientes; policies RLS chamam wrappers públicos escopados, evitando falha de permissão ou recursão de RLS.

`workspace_accept_invite` preserva email lock, expiração, usos, capacidade e token; exige member e emissor ainda autorizado. Locks workspace→convite seguem a ordem das mutações. `signup_invite_redeem` é preservado; emissão passa por `adminCreateSignupInvite` autenticado no servidor, sem novo formulário nesta tarefa.

## Policies/grants substituídos

| Tabela | Resultado |
| --- | --- |
| workspace_members | Retira `Admin or self inserts member`, `Admin updates members`, `Self leaves workspace`; cria `Owners insert own membership` (próprio owner canônico operacional) e `Self leaves nonowned workspace`; revoga UPDATE cliente. SELECT preservado. |
| workspaces | `Admin creates workspace` limitado a owner_id próprio; fases 4/6 protegem transferência direta e removem override de `Admin or owner updates/deletes workspace`. |
| workspace_invites | Retira `Admin creates invite`/`Admin deletes invite`; revoga INSERT/UPDATE/DELETE cliente. Leitura e aceite validado preservados. |
| user_roles | Sem escrita cliente nova; singleton/proteções Superadmin e TRUNCATE revogado/protegido. Leitura própria preservada. |
| map_overrides/custom_props | Retira `Admin can manage ...`; policies de escrita ficam locais ou supervisor membro. Acesso global usa handlers protegidos. |
| sprite_skins/storage.objects | Retira `Admin manages skins` e `Admin writes/updates/deletes sprite sheets`; leitura de catálogo global ou workspace acessível mantida; upload/administração pelo servidor. |
| account_groups | Retira `Admins manage groups`; gestão passa pelo servidor. Leitura ampla `USING(true)` permanece como pendência separada. |
| signup_invites | Retira `Admins manage signup invites` e grants cliente de escrita; emissão protegida e redeem preservados. |
| map_save_points | Remove master dos reads/create/delete; preserva leitura de membro e escrita local admin/owner. |
| rtc_events | `Admins read workspace rtc events` passa a admin local; inserts/reads próprios preservados. Sem mudança de runtime RTC. |
| meeting_participants | Policy usa helper atualizado, sem override global admin/master; participante/destinatário/local admin mantêm regras próprias. |

O SQL completo de cada policy está nos arquivos acima. Policies inesperadas de membership ou overrides globais residuais abortam a transação para revisão explícita.

## Gate de funções da fase 6

Além de `pg_policies`, o gate inventaria `pg_proc` com `pg_get_functiondef`, incluindo funções/procedures em public, platform_private e outros schemas de aplicação. Exclui schemas de sistema e não passa aggregates a pg_get_functiondef. É uma verificação textual conservadora: qualquer literal exato admin/master, com aspas simples ou dollar quoting, exige revisão. Menção não relacionada a autorização também pode bloquear, deliberadamente, para análise humana.

A allowlist fixa as sete assinaturas abaixo, fingerprint MD5 do corpo revisado, owner postgres, linguagem, SECURITY DEFINER, search_path e EXECUTE efetivo para anon/authenticated/service_role. O fingerprint serve para detectar divergência, não como uma prova semântica ou assinatura criptográfica. Sobrecarga, alteração do corpo (mesmo removendo as labels), owner/configuração/grants inesperados ou função allowlisted ausente bloqueiam o corte.

| Exceção explícita | Motivo restrito |
| --- | --- |
| platform_bootstrap_superadmin() | Interseção inicial única validada; service-only, sem autoridade permanente por admin/master. |
| platform_recover_superadmin(uuid) | Recuperação service-only e transferência de compatibilidade legada antes do corte. |
| platform_set_global_role(uuid,app_role,boolean) | Exige Superadmin explícito; admin/master são roles-alvo, sem autorizar o ator. |
| platform_private.is_workspace_admin(uuid,uuid) | Owner/admin local por workspace, sem override global. |
| platform_private.require_membership_manager(uuid,uuid,workspace_role) | Superadmin explícito ou gestão local limitada a membros comuns. |
| platform_transfer_workspace_owner(uuid,uuid,workspace_role) | Superadmin explícito; admin é apenas papel local permitido para o antigo owner. |
| can_record_meeting(uuid,uuid) | Capacidade de gravação limitada a membership/owner canônico, sem poder administrativo global. |

A criação própria continua somente na policy previamente revisada, não justifica exceção genérica para funções. Lifecycle e gestão local acima também não concedem autorização por admin/master global. Não há wildcard de nomes/schemas.

Função desconhecida não é reescrita nem removida. O erro lista apenas assinaturas, sem corpo/dados pessoais, e reverte toda a fase 6: policies, grants, funções e flag retired. Fases anteriores permanecem. O gate não detecta semanticamente toda autorização dinâmica/construída; o inventário e a revisão humana continuam obrigatórios. Funções legítimas adicionais exigem revisão explícita, nunca expansão automática da allowlist.

## Aplicativo

Guard central `permissions.server.ts`; contas, espaços, personagens e geração de sprites usam Superadmin. Memberships/perfis/criação/transferência usam RPCs. Painéis e botões globais reconhecem a role explícita; criação própria elegível continua separada. A UI distingue atribuição de membership de **Transferir propriedade**, com confirmação; o antigo owner vira member.

Mapas, save points e props têm transporte server-side protegido para Superadmin sem membership; acesso local continua RLS. Versionamento/reset do mapa usa a persistência existente. Falhas de transporte não deixam Save Points ocupado nem descartam a galeria anterior.

Gravações mudam apenas gates de autorização global e enum de capacidade; Egress/R2/mídia intactos. `OfficeScene` muda apenas o gate visual do editor. Não há mudanças em RTC/RoomManager/Presence/movimento/sessão/Privacy Guard/Desktop. Tipos locais atualizados; comparar com geração oficial em homologação.

## Rollback

1. **Antes de hardening:** interromper rollout; labels/policies legadas continuam. Manter enum/foundation/proteções. Não executar bootstrap outra vez para recuperar conta: usar `platform_recover_superadmin` por canal privado service-only.
2. **Falha de SQL:** 2–6 têm transação; erro reverte integralmente a etapa que falhou, incluindo flags/grants. Etapas anteriores permanecem. O enum em 1 é aditivo; não tentar remover label usada.
3. **Falha na fase 5 ou 6:** parar, manter fases anteriores e aplicativo compatível com as RPCs; correção para frente. Não presumir rollback conjunto de fases separadas.
4. **Após corte:** retornar somente a commit do aplicativo que reconhece Superadmin; manter hardening. Nunca restaurar self-join, convites privilegiados ou override automático de admin/master.
5. **Titular inacessível:** recuperação service-only valida/bloqueia alvo ativo e troca singleton atomicamente. Antes do corte transfere compatibilidade legada; após corte atribui somente Superadmin. Limpa confirmação/atestação, exigindo nova homologação. Identidade fornecida privadamente na execução, nunca no Git.

Um rollback SQL que restaure policies inseguras não faz parte deste pacote. Backups/catálogo completo/identidades operacionais ficam privados. Reverter código para versão antiga que só conhece admin não é rollback seguro após corte.

## Testes e homologação pendente

Comando SQL: `PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_superadmin_proposals.py --migrations`. PostgreSQL 16 descartável, sem rede/porta; fixtures fictícias. Cobre interseção única e preservação legada, ausência de promoção automática, singleton, proteção do titular, recovery antes/depois, concorrência, gates/rollback/idempotência, hardening, convites, transferência atômica, helper privacy e RLS **positivo** com authenticated.

Aplicativo: `npm test`, `npx tsc --noEmit`, `npm run build`. Testes executam guards/handlers e composição do painel com Superadmin sem labels antigas; admin/master e falha do banco não alcançam o client privilegiado. Regressões de mapa/recording e erros do transporte também cobertos.

Isso comprova o comportamento do código com fixtures; **não comprova que a conta real já recebeu Superadmin**. Antes de aplicar/cortar: REST/JWT reais, Auth admin API, painéis/overlays na composição real, operações globais sem membership, regras locais, gravação e ensaio de recovery. Memberships órfãs após exclusão Auth são limitação histórica fora deste pacote; leitura ampla account_groups continua pendente. Nada autoriza aplicação/publicação automática.

Verificação local concluída em 14/10/2026: **133 asserções SQL no pacote anterior**, dois cenários concorrentes, **643 testes Vitest em 57 arquivos**, typecheck e build aprovados. A revisão independente encontrou duas regressões (helpers privados em RLS e rejeições do transporte); ambas foram reproduzidas e corrigidas com testes. O build mantém avisos de dependências, sem falha de compilação.

Atualização do gate/staging (14/10/2026): as seis etapas saíram da descoberta automática. A suite executável passou **142 asserções SQL**, incluindo nove casos novos de bloqueio e rollback por função/grants inesperados; referência histórica e suite de membership também verificadas separadamente. Nesta atualização, **643 testes Vitest em 57 arquivos**, typecheck e build passaram novamente. A referência histórica passou 90 asserções e a suite de membership passou 21, todas em bancos descartáveis.
