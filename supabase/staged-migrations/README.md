# Fonte canônica revisada do rollout

Este diretório contém o SQL revisado/canônico de Superadmin. Está fora de `supabase/migrations` para impedir descoberta automática. Nenhuma etapa deve ser copiada/aplicada sem autorização explícita individual.

Fases 1–3 já foram executadas pelo Lovable no banco real, conforme confirmação do responsável. Os arquivos canônicos dessas fases não devem ser reaplicados para “corrigir” a execução nem editados retroativamente. A reconciliação nova `20261014120230_foundation_reconciliation.sql` está **staged e NÃO aplicada**, entre 3 e 4. Fases 4–6 continuam pendentes.

`drizzle/migrations/0000–0002` e seus metadados registram o que o executor Lovable efetivamente aplicou; são histórico imutável, não uma segunda fonte editável do rollout. Novas correções devem ser SQL novo revisado aqui. Não rodar Drizzle generate/push/migrate para reconciliar automaticamente o banco.

Ordem, gates, validações e rollback: [manifesto](../../docs/security/superadmin-rollout.md) e [runbook da reconciliação](../../docs/security/foundation-reconciliation-runbook.md).
