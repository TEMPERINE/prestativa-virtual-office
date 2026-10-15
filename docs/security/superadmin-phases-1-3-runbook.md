# Roteiro operacional — Superadmin, fases 1, 2 e 3

**Registro histórico concluído:** o responsável confirmou aplicação das fases 1–3 pelo executor Lovable (Drizzle 0000–0002), counts 1/1/1 na mesma conta, bootstrapped=true, um bootstrap, zero recoveries e fingerprints legados intactos. Não repetir estas fases. A transformação do executor alterou quatro comentários/corpos e omitiu quatro ACLs privadas; o contrato estrito abaixo só ficará integralmente reconciliado após a nova etapa [foundation reconciliation](foundation-reconciliation-runbook.md), ainda staged/NÃO aplicada. Os SELECTs/SQLs originais abaixo permanecem como roteiro histórico aprovado, não como autorização nova.

**Estado original do roteiro, anterior à execução: preparado para revisão; execução ainda não autorizada.** Não executar nenhum bloco ao receber este roteiro. O pacote aprovado de SQL é o commit `c2cacabe85d50e93dff5f81cb237bf51e9c3a813`, branch `codex/workspace-membership-hardening`. Nenhum SQL deste roteiro foi executado na preparação original; a conclusão posterior reportada pelo responsável está registrada acima.

Use o SQL Editor conectado ao banco do Prestativa Office, em sessão administrativa confiável `postgres`. Se estiver usando o chat do Lovable, solicite a execução de exatamente um arquivo/bloco por vez, com devolução do resultado completo, sem alterações extras nem criação/aplicação automática de migrations. A primeira consulta precisa confirmar a identidade/permissão do executor; se o meio não permite garantir SQL integral, transação e commit, pare e use o SQL Editor. Não enviar chaves, tokens, UUIDs ou e-mails no chat.

O fluxo de cada fase é: **SELECT anterior → interpretar resultado → nova autorização explícita para essa fase → aplicar só o SQL dessa fase → SELECT posterior em execução separada → devolver resultado → parar**. A conclusão de uma fase não autoriza a seguinte. Não publicar aplicativo, trocar branch do Lovable, fazer merge ou executar RPCs administrativas/recuperação/atestação neste procedimento.

Guarde um backup privado antes de qualquer DDL, no mecanismo disponível no provedor, e registre o projeto/ambiente confirmado, commit, operador e resultados. Sem dados pessoais no Git. Execute cada script integralmente em uma sessão sem transação anterior aberta. Não juntar as fases em um único envio. Não editar os SQLs aprovados para fazer validações passarem.

## Resultados comuns das consultas

Todas as seis consultas de verificação são **somente SELECT**, com resultado agregado: contagens, booleans e fingerprints do catálogo. Não retornam UUID, e-mail, nome, token ou corpo de função.

| Campo | Esperado em todas as verificações |
| --- | --- |
| usuarios_admin / usuarios_master / intersecao / candidatos_ativos | 1 / 1 / 1 / 1 |
| workspaces | 1 |
| memberships_member / memberships_admin / memberships_owner | 17 / 0 / 1 |
| convites / owners_ausentes / owners_nao_canonicos | 0 / 0 / 0 |
| validacao_ok | true |

Guarde `policies_fingerprint` e `funcoes_legadas_fingerprint` do primeiro SELECT: devem permanecer **exatamente iguais** antes/depois de todas as fases. Eles verificam que as policies centrais e helpers legados permaneceram inalterados. `validacao_ok` não compara valores de execuções anteriores: essa comparação é obrigatória pelo operador. Fingerprint vazio/null, mudança de contagem, `validacao_ok=false/null`, erro ou resultado truncado manda parar; não inferir sucesso a partir de “query completed”.

As verificações exigem o inventário aprovado exato. Uma mudança legítima posterior, como novo membro, também manda parar para reconfirmar o baseline; não deve ser revertida automaticamente. Em caso de erro, devolver mensagem/código sem dados pessoais e não rodar a próxima fase.

## Fase 1 — adicionar o valor ao enum

**1. Antes:** abrir [01-before.sql](operations/superadmin-1-3/01-before.sql), copiar e executar somente seu SELECT, depois da autorização de leitura. Resultado: `operador_apto=true`, `enum_superadmin=false`, `schema_privado_ausente=true`, `rpcs_platform_ausentes=true`, `usuarios_superadmin=0`, baseline acima e `validacao_ok=true`.

O SELECT exige executor postgres, leitura completa das roles/conta sob RLS, privilégios de trigger e criação. Falha por coluna/permissão/objeto ausente indica pré-requisito não confirmado: parar sem conceder privilégios ou alterar owners automaticamente. Enum já presente indica execução anterior/estado diferente; reconciliar primeiro, sem repetir DDL cegamente.

**2. SQL exato de aplicação, após autorização desta fase:** a DDL aprovada de [20261014120000_superadmin_role.sql](../../supabase/staged-migrations/20261014120000_superadmin_role.sql), isolada com commit explícito:

```sql
BEGIN;
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superadmin';
COMMIT;
```

**3. Imediatamente depois:** em uma execução separada, executar [01-after.sql](operations/superadmin-1-3/01-after.sql). Esperado: mesmos resultados anteriores, com `enum_superadmin=true`; `usuarios_superadmin=0`. Os dois fingerprints devem continuar iguais. A fase adiciona capacidade estrutural, não atribui role.

**4. Parar:** se o novo enum não estiver presente, a role já estiver atribuída, surgir estrutura/RPC inesperada, qualquer contagem/fingerprint mudar ou não houver confirmação do COMMIT. Mesmo com tudo correto, parar e devolver resultado antes da fase seguinte.

**5. Se falhar:** se houver transação aberta/abortada, finalizar **somente essa sessão** com `ROLLBACK;` e rodar novamente o SELECT posterior em execução separada para identificar o estado. Se o enum não existir, nada foi confirmado; não prosseguir. Se existir após commit, mantê-lo e reconciliar o resultado; nunca usar DELETE em pg_enum ou presumir remoção simples do valor. Adição de enum é aditiva e sua reversão após commit exigiria reconstrução deliberada do tipo/dependências, fora deste roteiro. Não repetir após timeout sem verificar primeiro.

## Fase 2 — foundation e RPCs, sem atribuição

**1. Antes:** executar [02-before.sql](operations/superadmin-1-3/02-before.sql). Esperado: `operador_apto=true`, `enum_superadmin=true`, schema/RPCs ainda ausentes, `usuarios_superadmin=0`, baseline e fingerprints inalterados. A presença do enum deve estar confirmada após o commit independente da fase 1.

**2. SQL exato de aplicação, após autorização desta fase:** copiar **todo o arquivo**, do BEGIN ao COMMIT, sem abreviar ou acrescentar comandos:

- [20261014120100_superadmin_foundation_and_rpcs.sql — arquivo local integral](../../supabase/staged-migrations/20261014120100_superadmin_foundation_and_rpcs.sql)
- [Mesmo SQL no commit aprovado — GitHub Raw](https://raw.githubusercontent.com/TEMPERINE/prestativa-virtual-office/c2cacabe85d50e93dff5f81cb237bf51e9c3a813/supabase/staged-migrations/20261014120100_superadmin_foundation_and_rpcs.sql)

Esse arquivo é o SQL executável, não um resumo ou pseudocódigo. Não usar versões históricas de proposals, não chamar bootstrap ou recovery junto. Cria infraestrutura, proteções e funções; conserva admin/master e policies legadas. Revoga TRUNCATE de user_roles e protege operações destrutivas contra o futuro titular; essas proteções são parte aprovada da foundation.

**3. Imediatamente depois:** executar [02-after.sql](operations/superadmin-1-3/02-after.sql). Resultado esperado:

| Campo | Esperado |
| --- | --- |
| operador_postgres / validacao_ok | true / true |
| funcoes_esperadas / funcoes_encontradas / contratos_ok | 25 / 25 / 25 |
| triggers_ativos | 4 |
| indice_singleton_ok / objetos_privados_isolados / recuperacao_service_only / truncate_roles_bloqueado | todos true |
| linhas_estado / singleton_ok / somente_preparacao | 1 / true / true |
| usuarios_superadmin / bootstrap_concluido / titular_e_intersecao_ativa | 0 / false / false |
| eventos_auditoria / eventos_bootstrap | 0 / 0 |

O SELECT confere assinaturas, fingerprints dos 25 corpos aprovados, owner, SECURITY DEFINER/INVOKER, linguagem, search_path, EXECUTE efetivo e quatro triggers com função/eventos corretos. Recovery deve estar inacessível a anon/authenticated e executável por service_role; não se testa recuperação chamando-a no banco real. Nenhuma role atribuída aqui. Os fingerprints legados e baseline devem continuar iguais.

**4. Parar:** função faltante/divergente, grant indevido, owner/configuração inesperada, proteção ausente, state diferente, qualquer Superadmin/auditoria já existente ou mudança de legado/baseline. Não executar a fase 3 apenas porque o SQL terminou. Devolver resultado e aguardar.

**5. Se falhar:** executar `ROLLBACK;` somente se a sessão ainda mantiver a transação aberta/abortada; encerramento da conexão também reverte uma transação não confirmada. A foundation inteira é transacional, e o enum confirmado anteriormente permanece. Rodar `02-before.sql` para confirmar estado anterior; se tiver ocorrido commit ou perda da resposta, `02-after.sql` identifica eventual conclusão. Ausência de tabelas na verificação posterior é evidência de etapa não instalada, não motivo para criar partes manualmente. Se objetos parciais/inesperados aparecerem, parar e reconciliar; não apagar schema, roles ou proteções. Reexecução idempotente só após revisão e nova autorização.

## Fase 3 — bootstrap exclusivo da interseção confirmada

**1. Antes:** executar [03-before.sql](operations/superadmin-1-3/03-before.sql). É a mesma validação completa posterior à foundation, repetida imediatamente antes do bootstrap. Esperado: baseline/fingerprints intactos, contratos/proteções corretos, zero Superadmins/eventos, `bootstrap_concluido=false`, `validacao_ok=true`. Estado já inicializado indica que não é uma primeira execução: parar para reconciliar.

**2. SQL exato de aplicação, após autorização desta fase:** [20261014120200_superadmin_bootstrap.sql](../../supabase/staged-migrations/20261014120200_superadmin_bootstrap.sql), integralmente:

```sql
BEGIN;
DO $$ BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT (SELECT bootstrapped FROM platform_private.transition WHERE singleton) THEN
    PERFORM public.platform_bootstrap_superadmin();
  ELSIF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.role='superadmin'
                    AND platform_private.is_superadmin(r.user_id)) THEN
    RAISE EXCEPTION 'bootstrap already ran but holder is inactive; use service recovery';
  END IF;
END $$;
COMMIT;
```

Executar como owner SQL confiável postgres. O DO chama a função protegida no servidor; não precisa de chave service_role no chat. A função é inacessível a anon/authenticated e, além do owner SQL, tem EXECUTE apenas service_role. Revalida admin=1, master=1 e interseção=1, bloqueia tabelas/conta e aborta se o candidato não estiver ativo. Não recebe identidade, não promove outros usuários e não remove as roles legadas.

**3. Imediatamente depois:** executar [03-after.sql](operations/superadmin-1-3/03-after.sql). Esperado: contratos/proteções/baseline anteriores intactos, com estas mudanças somente:

| Campo | Esperado |
| --- | --- |
| usuarios_superadmin | 1 |
| bootstrap_concluido | true |
| titular_e_intersecao_ativa | true |
| eventos_auditoria / eventos_bootstrap | 1 / 1 |
| somente_preparacao / validacao_ok | true / true |

Admin/master/interseção permanecem 1/1/1; fingerprints legados permanecem iguais. A checagem do titular usa somente SELECT no contexto administrativo, sem retornar sua identidade nem forjar auth.uid. `platform_is_superadmin()` em SQL Editor sem JWT não comprovaria o login do titular; este roteiro confirma a atribuição, não a homologação do aplicativo novo.

**4. Parar:** counts fora de 1/1/1, candidato inativo, qualquer grant/proteção divergente, Superadmin diferente da interseção, evento de recuperação/outra administração, remoção de label legada, state/fingerprints inesperados ou validação false/null. Com tudo certo, encerrar o procedimento e devolver resultados; não invocar outras RPCs nem publicar aplicação.

**5. Se falhar:** se a transação continuar aberta/abortada, executar `ROLLBACK;` nessa sessão. Atribuição, flag e evento de auditoria revertem juntos; fase 2/enum permanecem. Após erro de execução, consultar `03-before.sql` para confirmar bootstrap ainda não feito. Se houve timeout/resposta perdida, usar `03-after.sql` para verificar possível commit antes de repetir; um estado já confirmado não exige novo bootstrap. Se counts/candidato mudaram, parar sem escolher alguém manualmente, alterar dados ou chamar recovery. Recovery é procedimento separado de emergência, exige autorização própria e pode transferir compatibilidade legada; não faz parte da inicialização normal.

## Limites desta preparação

Consultas e arquivos foram confrontados estaticamente com o SQL aprovado. Não foram executados em banco real nem descartável nesta tarefa. Nenhuma garantia de estado atual do banco decorre desses arquivos: é o resultado dos SELECTs autorizados que decidirá se cada etapa pode prosseguir. Não há script de execução em lote, simulação de JWT, identificador pessoal hardcoded, merge, push novo ou publicação nesta preparação.
