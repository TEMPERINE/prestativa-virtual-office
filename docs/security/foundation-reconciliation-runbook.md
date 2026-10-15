# Foundation reconciliation — preparação, NÃO aplicada

Fases 1–3 concluídas no banco real **conforme confirmação do responsável**, via executor Lovable registrado em Drizzle 0000–0002. Nesta tarefa não foi consultado nem alterado o banco real. Estado reportado: admin=1, master=1, superadmin=1, mesma interseção ativa, bootstrapped=true, um bootstrap e nenhuma recovery; 1 workspace, 17 members, 1 owner canônico, zero admins locais/convites. Fingerprints legados reportados: policies `9a8d6531f9dcc9c0694ccd97f0fbad96`; funções `f66ab855691739ebc5fd6fc6d8c9e6bf`.

A execução transformou comentários em quatro corpos e omitiu revogação de PUBLIC/authenticated nos quatro helpers privados. Sem USAGE do schema, os clientes não os chamam diretamente, mas essa ACL diverge do contrato aprovado. Não tentar normalizar reaplicando as fases anteriores. Drizzle 0000–0002 é histórico imutável; staged é a fonte canônica de revisão.

## SQL exato e ordem

Antes da fase 4, após **nova autorização explícita**, usar integralmente [20261014120230_foundation_reconciliation.sql](../../supabase/staged-migrations/20261014120230_foundation_reconciliation.sql), do BEGIN ao COMMIT. Este link contém o SQL completo, sem trechos omitidos. Não há execução automática ou nova migration Drizzle nesta preparação.

1. Confirmar ambiente/operador postgres confiável, backup privado e ausência de operação administrativa concorrente. Executar somente [before.sql](operations/foundation-reconciliation/before.sql); devolver resultado e comparar os dois fingerprints ao baseline acima. Parar se estado, catálogo ou ACL divergirem além dos casos conhecidos.
2. Aguardar autorização individual para executar o SQL staged integralmente. Ele trava o singleton (mesma ordem da recovery), roles e a conta ativa para estabilizar o baseline. Exige pós-bootstrap antes da fase 4, counts 1/1/1 na mesma conta, um bootstrap e nenhuma recovery. Definições completas (incluindo defaults, STRICT, volatilidade e demais atributos), owner/search_path/grants públicos desconhecidos abortam; nenhum identificador é retornado.
3. Imediatamente após COMMIT, em execução separada, executar somente [after.sql](operations/foundation-reconciliation/after.sql). Esperado: 25 contratos canônicos, nenhuma rotina privada com EXECUTE para PUBLIC/anon/authenticated/service_role, schema sem USAGE/CREATE para esses clientes, fingerprints/dados/flags inalterados e `validacao_ok=true`. Comparar fingerprints com o SELECT anterior; o booleano não compara execuções por si só.
4. Parar e homologar. Resultado correto não autoriza fase 4, RPC de atestação, publicação ou merge. Um novo dado/membro legítimo exige reconfirmar baseline, sem reversão automática.

## Funções recriadas condicionalmente

Somente se `prosrc` corresponder exatamente à transformação conhecida do executor:

| Assinatura | MD5 executor → canônico | EXECUTE público preservado |
| --- | --- | --- |
| `public.platform_recover_superadmin(uuid)` | `ceb5f5d893786845e1a259e65cc45972` → `9e8dcf760fb482e0f54e740cc349931a` | service_role; nunca anon/authenticated/PUBLIC |
| `platform_private.require_cutover_ready()` | `0f7ce734b3df838e9f8155399894857d` → `bcbeee1148aa17cd4005fe92e6100824` | nenhum cliente |
| `public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role)` | `dd89f7f00ae4cfe0adb87b46f83c4dd9` → `60eecad14c0e6bc30dfb4a99de637e6e` | authenticated com guard Superadmin |
| `public.platform_create_workspace_invite(uuid,text,interval)` | `3cb1ccb45842ff6fe8bb9548b771fd20` → `6e83eb65ce8dcf99cd3f7e76fc4e6722` | authenticated com gestor validado |

CREATE OR REPLACE preserva identidade/OID e ACL da função. Corpos já canônicos dispensam DDL. Mudança somente de comentários; lógica, assinaturas, SECURITY DEFINER e search_path aprovados permanecem. O MD5 detecta drift, não prova semântica nem substitui custódia do operador SQL. O contrato compara também a definição completa renderizada por pg_get_functiondef, normalizando apenas a qualificação public dependente da visibilidade de tipos; prosrc continua comparado exatamente. Mudança de renderização no provedor manda parar para revisão, nunca ampliar automaticamente os hashes.

## Grants antes/depois

| Objeto | Antes reportado / reproduzido | Depois esperado |
| --- | --- | --- |
| `is_superadmin(uuid)`, `has_role(uuid,app_role)`, `is_workspace_member(uuid,uuid)`, `is_workspace_admin(uuid,uuid)` no schema privado | PUBLIC EXECUTE herdado; anon/authenticated/service_role efetivamente true, apesar de schema inacessível | REVOKE EXECUTE explícito de PUBLIC e três roles; todos false |
| Schema platform_private | sem USAGE para clientes | continua sem USAGE/CREATE para PUBLIC e três roles |
| Outros helpers privados | sem EXECUTE cliente | preservados e verificados individualmente por inventário de TODAS as rotinas privadas |
| RPCs públicas, policies, grants de tabelas legadas | contrato anterior | inalterados |

A fase 6 agora aborta por qualquer EXECUTE privado indevido, inclusive rotina nova, default PUBLIC, grant direto/herdado e função sem literal admin/master. Não basta ocultar o schema. Allowlist de autorização legada continua estrita.

## Parada e falha

Erro/resultado truncado/validação falsa: parar sem contornar. Se transação estiver aberta/abortada, ROLLBACK na mesma sessão; DDL e ACL revertem juntos. Após timeout/resposta perdida, SELECT after antes de repetir. Reconciliação é idempotente enquanto ainda antes da fase 4. Nenhuma fase passada é reaplicada e nenhuma recovery é acionada automaticamente.

Após COMMIT, preferir correção revisada para frente. Não reabrir PUBLIC/EXECUTE privado nem remover superadmin do enum. A conta conserva admin/master/superadmin, singleton, proteções e recovery service-only; nenhuma mutation/auditoria nova é feita pela reconciliação. Ownership/membership/convites/policies e invariantes RTC permanecem intactos.

## Exclusões e limites

signup_invites foi removida historicamente em `20260609082850`; não será recriada. O handler sem consumidores, dois testes de emissão, fixtures/redeem artificiais e referências executáveis da fase 6 foram retirados. Convites de workspace continuam no fluxo existente. Signup futuro será feature separada.

Os testes usam PostgreSQL descartável sem rede/porta e contas fictícias. Homologação real de Auth/JWT, painel e acesso administrativo continua necessária antes do hardening. Esta etapa não publica web, Desktop ou migrations.
