# Histórico de execução Lovable

`migrations/0000_superadmin_role.sql`, `0001_superadmin_foundation_and_rpcs.sql`, `0002_superadmin_bootstrap.sql`, snapshots e journal são o registro histórico das fases 1–3 aplicadas pelo executor Lovable. Preservar esses arquivos byte a byte. Não reescrever migrations aplicadas nem editar versões concorrentes em paralelo.

A fonte SQL canônica revisada do rollout é `supabase/staged-migrations`. Divergências do executor são corrigidas por uma NOVA migration staged, com aprovação individual; nunca por regeneração/reexecução do histórico.

`drizzle.config.ts`, schema vazio, drizzle-kit, drizzle-orm e postgres permanecem por compatibilidade com o mecanismo do Lovable. São tooling de desenvolvimento; não foram importados no runtime da aplicação. O schema/snapshots vazios não representam o modelo completo do banco. Não usar generate/push/migrate contra o banco para inferir ou aplicar correções automáticas.

As versões já resolvidas pelo Bun foram fixadas em package.json e alinhadas ao package-lock.json. `npm ci` usa o lock npm; Bun usa seu próprio lock. Instalação de dependências não executa migrations. Nenhuma URL/credencial de banco deve ser versionada.
