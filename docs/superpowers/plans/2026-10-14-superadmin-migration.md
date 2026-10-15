# Superadmin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir Superadmin explícito e gestão de memberships por servidor, sem perda de acesso nem promoção automática de roles legadas.

**Architecture:** Infraestrutura aditiva precede atribuição privada service-only e rollout dos guards/UI. Hardening, revisão de helpers e retirada final de overrides têm etapas/transações próprias posteriores à confirmação do novo caminho. A recuperação substitui o singleton independentemente de membership local.

**Tech Stack:** PostgreSQL/Supabase RLS e RPC, TanStack Start, React, TypeScript, Vitest; PostgreSQL 16 em Docker para testes isolados.

**Spec:** `docs/security/superadmin-permissions-design.md`

## Global Constraints

- Não aplicar em produção, fazer merge/push ou publicar sem autorização específica.
- Não versionar identidades reais, credenciais, backups privados ou tokens.
- As seis etapas executáveis ficam em `supabase/staged-migrations`, fora da descoberta automática até autorização específica, inclusive enum/foundation.
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

## Arquivos e estado da implementação

Manifesto final: [superadmin-rollout.md](../../security/superadmin-rollout.md), com seis nomes finais, SQL completo por arquivo, ordem/gates, funções/policies e rollback. SQLs históricos 01–06 e draft antigo não devem ser aplicados junto do pacote final.

### Task 1: Inventário e preparação executável

- [x] Receber inventário reportado: interseção admin/master única; 1 workspace, 17 members, 1 owner canônico, 0 admins locais/convites e nenhuma inconsistência. Normalização não necessária.
- [x] Preparar seis etapas executáveis staged, sem qualquer migration de segurança no fluxo automático.
- [x] Preservar labels legadas, singleton e recuperação service-only, sem IDs pessoais versionados.
- [ ] Antes da execução real, repetir metadados/owners/grants e confirmar Auth.deleted_at/banned_until, RLS/bypass do owner postgres. O JSON completo do catálogo não foi entregue nesta conversa.

### Task 2: RPCs, hardening e autorização

- [x] Bootstrap exclusivo da interseção ativa 1/1/1; erro aborta.
- [x] Administração global e local por ator auth.uid; locals só membros comuns próprios; promoção/transferência reservada ao Superadmin.
- [x] Operações compostas role+perfil, metadados+transferência, criação workspace+owner atômicas.
- [x] INSERT cliente só próprio owner canônico; UPDATE administrativo cliente fechado; saída própria não canônica preservada.
- [x] Convites member-only em CHECK/RPC/aceite; validação de emissor e locks ordenados.
- [x] Helpers públicos escopados e grants de EXECUTE revisados; helpers privados isolados; RLS usa wrappers públicos callable.
- [x] Perfil/gravação em nova hierarquia, mantendo capacidades membership-bound aprovadas.
- [x] Corte final separado, com flags e confirmação/atestação; policies e funções desconhecidas abortam. Allowlist confere assinatura, corpo, owner, segurança e EXECUTE; sem reescrita automática.
- [ ] Testar endpoints REST/JWT/Auth de Supabase em homologação autorizada; nenhum acesso real nesta tarefa.

### Task 3: Guards, handlers e UI

- [x] Guard central consulta platform_is_superadmin por requisição antes do client service-role; admin/master negados.
- [x] Contas/espaços/skins/AI e painéis reconhecem Superadmin; RPCs de membership/perfil/owner e exclusão protegida.
- [x] Transferir propriedade explícito com confirmação; retirada do caminho owner por convite/criação de conta.
- [x] Handlers globais mapas/save points/props; operações locais mantidas; falhas de transporte tratadas.
- [x] Gates de gravação/UI/tipos adaptados; mecânica RTC/RoomManager/Presence/Egress/Desktop preservada.
- [ ] Comparar tipos com geração oficial e homologar painéis/overlays na composição real, inclusive sem membership nem labels antigas.

### Task 4: Verificação isolada e revisão

- [x] RED→GREEN para legado guard, enumeração de helpers, RPCs compostas, constraints, RLS positivo e erros de transporte.
- [x] PostgreSQL 16 descartável: scripts finais/idempotência, autorizações, convites, gates/rollback e duas transações concorrentes.
- [x] Suite Vitest completa, typecheck e build.
- [x] Revisão independente somente leitura; corrigidos dois achados de RLS/EXECUTE e rejeições do transporte.
- [ ] Homologação Supabase/Office real e ensaio de recuperação pelo operador.

### Task 5: Aplicação por etapas autorizadas

- [ ] Apresentar manifesto/diff/testes; obter autorização explícita de aplicação.
- [ ] Backup privado, confirmar commits/env e aplicar 1→2→3 no canal autorizado.
- [ ] Rollout autorizado de app; homologar e confirmar titular/atestar SHA.
- [ ] Aplicar 4→5 somente após Gate A; homologar caminhos locais/globais e convite.
- [ ] Aplicar 6 somente após Gate B e autorização; repetir inventário.
- [ ] Rollback/recuperação conforme manifesto; nunca reabrir policy insegura.

Esta tarefa encerra em implementação local e apresentação; nenhuma etapa de aplicação/publicação é autorizada pelo plano.

Reconciliação pós-bootstrap: fases 1–3 aplicadas pelo Lovable; histórico Drizzle preservado. Signup removido historicamente foi retirado do pacote. Continuação vigente em [foundation reconciliation](2026-10-14-foundation-reconciliation.md), sem execução real autorizada.
