# Foundation reconciliation pós-bootstrap

Escopo autorizado: preparação local na branch `codex/workspace-membership-hardening`, testes descartáveis e commit/push. Nenhum SQL remoto, aplicação, merge ou publicação.

1. Preservar byte a byte Drizzle 0000–0002 e snapshots/journal como histórico aplicado; staged é a fonte canônica revisada. Não editar fases 1–3 retroativamente.
2. Reproduzir a execução histórica em PostgreSQL descartável. Escrever regressões para quatro ACLs herdadas, quatro corpos alterados só em comentários, atomicidade, idempotência e preservação de dados/legado.
3. Adicionar `20261014120230_foundation_reconciliation.sql`, transacional, antes da fase 4. Aceitar somente corpos canônicos ou hashes conhecidos do executor; desconhecidos abortam. Recriar condicionalmente somente quatro funções; revogar os quatro helpers explicitamente e manter schema privado inacessível.
4. Gate da fase 6: inventariar ACL efetiva e PUBLIC de todas as rotinas privadas, inclusive sem literais admin/master. Não modificar a allowlist legada nem funções desconhecidas.
5. Retirar handler/testes obsoletos de signup, fixtures inventadas e referências executáveis da fase 6. Não criar tabela, RPC ou nova funcionalidade.
6. Preservar Drizzle como tooling de desenvolvimento; alinhar versões já resolvidas e validar ambos lockfiles sem executar CLI de banco. Atualizar manifesto e runbook com estado confirmado pelo operador e a reconciliação pendente.
7. Validar npm ci, SQL, Vitest, typecheck e build. Revisão independente final; corrigir apenas achados materiais e revalidar. Commit/push somente após conclusão.

Decisões locais: restauração de `prosrc` é estrita para não sobrescrever divergências desconhecidas; CREATE OR REPLACE preserva OID e grants públicos. O rollback é transacional; após commit preferir correção para frente, sem reabrir EXECUTE privado. O enum superadmin e roles permanecem intactos.
