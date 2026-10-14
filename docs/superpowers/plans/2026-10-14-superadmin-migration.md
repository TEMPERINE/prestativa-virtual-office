# Superadmin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir Superadmin explícito e gestão de memberships por servidor, sem perda de acesso nem promoção automática de roles legadas.

**Architecture:** Infraestrutura aditiva precede atribuição privada service-only e rollout dos guards/UI. Hardening e retirada de overrides acontecem numa transação posterior à confirmação do novo caminho. A recuperação substitui o singleton independentemente de membership local.

**Tech Stack:** PostgreSQL/Supabase RLS e RPC, TanStack Start, React, TypeScript, Vitest; PostgreSQL 16 em Docker para testes isolados.

**Spec:** `docs/security/superadmin-permissions-design.md`

## Global Constraints

- Não aplicar em produção, fazer merge/push ou publicar sem autorização específica.
- Não versionar identidades reais, credenciais, backups privados ou tokens.
- Migrations propostas ficam fora de `supabase/migrations` até revisão/aprovação.
- Confirmar catálogo/owners/grants reais; counts informados não comprovam o catálogo.
- Não retirar overrides antes de confirmar Superadmin funcional em todos os fluxos.
- Um Superadmin; recuperação service-only; nenhuma promoção automática admin/master.
- Owner/admin local só administram membros comuns do próprio workspace por servidor.
- Não modificar RTC, RoomManager, Presence, mídia, movimento, sessão, Egress/R2 ou Desktop.
- Ler handoff/documentos RTC relacionados; testar overlays na composição real.
- Diagnóstico → menor correção → testes → homologação → publicação autorizada.

## Review Focus

- Conta de recuperação banida durante a atribuição: abortar e preservar titular atual.
- Recuperação durante o corte: bloquear até commit da transação de aposentadoria.
- Cliente/serviço usando TRUNCATE: não apagar a atribuição protegida acidentalmente.
- Convite privilegiado/owner não canônico já existente: abortar o corte e exigir correção privada explícita.
- Superadmin sem membership e sem labels legadas: painel/handlers devem funcionar sem criar bypass RLS cliente.

---

## Arquivos e estado da preparação

Preparados para revisão: `docs/security/proposals/superadmin/{00-preflight-readonly,01-role,02-foundation,03-administration-rpcs,04-membership-cutover,05-legacy-overrides-cutover,06-cutover-transaction}.sql`,
`scripts/test_superadmin_proposals.py`, `supabase/tests/superadmin/{fixtures,foundation,authorization}.sql`.
Nenhum foi colocado no fluxo ativo de migrations. O aplicativo abaixo ainda precisa ser implementado/homologado.

### Task 1: Conferir catálogo real e aprovar SQL

**Files:** SQL 00–06 acima; `docs/security/superadmin-permissions-design.md`.

**Interfaces:** Consome catálogo real somente leitura. Produz SQL versionado revisado, compatível com o owner confiável e as policies realmente existentes.

- [ ] Executar 00 manualmente em sessão autorizada e receber somente metadados/contagens; confirmar auth.users.deleted_at/banned_until e bypass RLS do owner postgres.
- [ ] Confrontar policies/RPCs/grants reais com o manifesto. Reconciliar paths adicionais e privilégios por coluna; não fazer substituição automática de texto em funções/policies.
- [ ] Inventariar owners não canônicos, owners sem membership, convites privilegiados e legitimidade de admins/owners/estratégicos preexistentes à correção da autoentrada. Preparar correção individual privada sem IDs no Git.
- [ ] Rodar `PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_superadmin_proposals.py`; exigir PASS, incluindo duas transações concorrentes e TRUNCATE.
- [ ] Revisar o diff completo e obter autorização específica antes de converter/aplicar qualquer proposta.

### Task 2: Instalar infraestrutura aditiva e validar atribuição

**Files:** SQL 01–03; `supabase/tests/superadmin/foundation.sql`.

**Interfaces:** Produz `platform_is_superadmin()`, bootstrap/recovery service-only e RPCs administrativas conforme tabela de contratos da spec.

- [ ] Em homologação Supabase, executar 01 e commit separado, depois 02; confirmar owner/search_path e EXECUTE real via catálogo.
- [ ] Testar REST autenticado/anon: bootstrap/recovery/atestação negados ao cliente; manutenção GUC não concede privilégios.
- [ ] Invocar bootstrap por canal privado service-only. Conferir retorno sem identidade, role real do titular, counts 1/1/1 e manutenção de admin/master.
- [ ] Instalar 03; testar Superadmin sem membership e bloqueio de RPCs locais antes do hardening.
- [ ] Ensaiar recuperação em homologação: alvo ativo, singleton, proteção DELETE/ban/TRUNCATE, rollback por alvo inválido e bloqueio concorrente de conta.
- [ ] Não retirar acessos legados nem promover outros usuários nesta etapa.

### Task 3: Migrar guards, handlers e UI

**Files:** criar `src/lib/admin/permissions.server.ts`; modificar `src/lib/admin/{accounts,workspaces,sprites,ai-sprite}.functions.ts`,
`src/routes/_authenticated/admin.{index,contas,espacos,personagens}.tsx`, `src/routes/_authenticated/workspaces.{index,new}.tsx`,
`src/lib/workspace/create.ts`, `src/components/office/{OfficeScene,MapEditor,MapSavePoints}.tsx`, `src/lib/map-overrides.ts`,
`src/lib/meetings/{recording.functions,record-permission}.ts`, `src/components/meetings/MeetingsPanel.tsx`, `src/integrations/supabase/types.ts`.

**Interfaces:** `requireSuperadmin(context: {supabase: SupabaseClient<Database>; userId: string}): Promise<void>` verifica role do ator via client autenticado; usa `platform_is_superadmin()` e falha fechado. Consome RPCs da spec. Operações globais de mapa/convites têm handlers autenticados com esse guard; operações locais existentes permanecem escopadas.

- [ ] Escrever testes de guard/handlers: Superadmin reconhecido, labels admin/master isoladas negadas, role falsa/ator de payload ignorados, falha do banco negada e service_role não usado antes da autorização.
- [ ] Rodar testes e confirmar falha nos caminhos atuais que só reconhecem admin.
- [ ] Implementar guard central, substituir quatro ensureAdmin e migrar membership/profile/transferência/criação às RPCs; nunca invocar RPC com client service-role sem identidade autenticada de ator.
- [ ] Bloquear nova atribuição de admin/master enquanto overrides legados existirem; proteger alvo Superadmin em UI e servidor, sem botão de remoção/rebaixamento global.
- [ ] Implementar emissão server-side de signup invites e acesso/edição global de mapas/save points antes de retirar policies correspondentes. Reutilizar contratos de persistência/versionamento existentes; não criar fonte de verdade paralela.
- [ ] Atualizar gates visuais e tipos gerados. Separar capacidade de criação própria de administração global; Superadmin recuperado sem admin/master também funciona.
- [ ] Ajustar só autorização global nas gravações: Superadmin substitui admin/master; participantes/destinatários/local admins e Egress/R2 mantêm regras próprias. Adicionar superadmin ao recording capability membership-bound.
- [ ] Rodar testes pertinentes, suite completa, typecheck e build conforme ferramentas do projeto. Homologar painéis e overlays na composição real, inclusive Superadmin sem membership.
- [ ] Registrar commit/resultado de cada ação administrativa homologada; ainda não executar corte.

### Task 4: Homologar hardening e retirada atômica

**Files:** SQL 04–06; `supabase/tests/superadmin/authorization.sql`.

**Interfaces:** Consome role explícita/handlers do Task 3. Produz membership_hardened=true e retired=true somente após gates verificados e transação completa.

- [ ] Em homologação, exigir falha de 04 por policy desconhecida, convite privilegiado pendente e owner não canônico; não apagar dados para fazer o teste passar.
- [ ] Confirmar sessão via platform_acknowledge_superadmin_access; atestar commit homologado via platform_authorize_cutover em canal service-only.
- [ ] Rodar 04+05 numa transação. Provocar falha em 05 e comprovar rollback de toda a etapa, inclusive ativação de RPCs locais.
- [ ] Exercitar os oito casos solicitados: autoentrada, autopromoção, owner_id alheio, criação válida, convite válido, inválido/expirado/revogado, administração server-side e contorno cliente negado.
- [ ] Testar local owner/admin só membros comuns do próprio workspace; Superadmin promove/rebaixa/transfere sem membership, protegendo integridade canônica e plano.
- [ ] Repetir inventário de overrides e testes REST com JWT real após corte. Labels legadas não dão autoridade global. Supervisor só capacidades locais já permitidas.
- [ ] Ensaiar recuperação após corte e concorrência entre recuperação e readiness; substituto sem labels legadas mantém painel completo.

### Task 5: Rollout autorizado e rollback ensaiado

**Files:** spec, SQL aprovado e registro privado de homologação/backup.

**Interfaces:** Consome commits SQL/app aprovados e autorização explícita. Produz rollout rastreável, sem publicação implícita pelo push.

- [ ] Ensaiar rollback: pré-corte mantém legado; erro no corte reverte SQL inteiro; pós-corte retorna a aplicativo compatível com Superadmin e preserva hardening.
- [ ] Conferir caminho de recuperação e backup privado. Não remover enum/singleton nem reabrir self-join para rollback.
- [ ] Apresentar diff final, SQL completo, catálogo real, testes/limitações e commits antes de solicitar autorização de produção.
- [ ] Executar apenas etapas expressamente autorizadas; confirmar main/preview/produção, commits/env e permissões efetivas após cada uma.

Esta tarefa entrega preparação/revisão, não inicia os Tasks de aplicação ou publicação.
