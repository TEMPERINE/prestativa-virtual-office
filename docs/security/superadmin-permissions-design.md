# Superadmin e membership — desenho para revisão

Status: desenho conceitual aprovado, com requisitos adicionais ainda a consolidar.
Inventário do banco real pendente; nenhuma migration nova pronta para aplicação e nenhum deploy.
A branch é codex/workspace-membership-hardening, baseada em 2088d7f.
Este documento é um rascunho de revisão. Nenhum identificador real do titular
pode ser incluído em migration, código ou documentação versionada. A atribuição
inicial e a recuperação serão procedimentos privilegiados fora do repositório.
Não remover overrides legados antes de comprovar o novo acesso completo.
O candidato anterior de INSERT foi retirado de supabase/migrations e está em
docs/drafts/workspace-membership-insert-hardening.sql. Não é o desenho final.

## Fatos do repositório e limites da inspeção

- auth.users.id é a identidade; profiles.id referencia essa conta.
- As migrations históricas não comprovam a identidade autenticada nem a
  atribuição atual de roles do titular. Esses dados exigem inventário privado.
- user_roles já armazena roles globais. Os tipos atuais incluem admin,
  supervisor, member e master. Não existe superadmin no contrato atual.
- workspace_members.role é separado: owner, admin ou member por workspace.
- Os handlers de contas e workspaces usam ensureAdmin, consultam role global
  admin e depois utilizam supabaseAdmin/service_role. Esse admin é global,
  não o admin de workspace.
- master aparece em autorizações de gravações e outras policies, mas não é
  aceito consistentemente pelos guards e painéis administrativos.
- Políticas antigas concedem overrides globais diretamente a admin, além de
  permitir administração direta de memberships por admins de workspace.
- Não consultamos o catálogo ou os dados de produção. O UUID de titular confirmado,
  suas roles atuais, os outros titulares privilegiados e os owners das
  funções devem ser confirmados por consulta somente leitura antes do rollout.

## Separação proposta

Adicionar a role global explícita superadmin em user_roles. Sua única
atribuição inicial será ao UUID da conta titular confirmado confirmado no banco e pelo
responsável. Nome, e-mail, primeiro usuário ou uma role admin existente não
autorizam promoção automática.

| Papel | Escopo | Capacidade proposta |
| --- | --- | --- |
| Superadmin | Plataforma inteira | Contas, qualquer workspace, memberships, roles e transferência de propriedade por operações server-side validadas |
| Owner | Seu workspace | Gestão local permitida; sem poder de plataforma |
| Admin de workspace | Workspace da sua membership | Administração local explicitamente permitida; sem poder de plataforma |
| Membro | Workspaces autorizados | Uso normal; sem gestão de memberships ou roles |
| admin global legado | Reservado para compatibilidade/futuro | Não satisfaz requireSuperadmin; não recebe override global implícito |
| master legado | Precisa de inventário de uso | Não equivale automaticamente a superadmin; não será promovido em lote |

Para fechar a definição do MVP de permissões, a recomendação é reservar
promoção/rebaixamento de owner/admin e transferência de propriedade ao
Superadmin. Owner/admin local podem gerir membros comuns apenas no seu
workspace por operações server-side; qualquer delegação maior será explícita.
Essa distribuição local é proposta para revisão, não uma regra já implantada.

## Autoridade server-side

1. Guard central requireSuperadmin autentica a sessão e verifica a role
   superadmin atual no banco a cada operação. Não confia em role da UI,
   user_metadata, nome/e-mail ou actor_id enviado pelo cliente.
2. Handlers de contas e operações globais validam esse guard ANTES de usar
   service_role. A chave permanece exclusivamente server-side.
3. RPCs privilegiadas de membership autenticam auth.uid(), verificam
   superadmin ou a permissão local apropriada e só então executam a escrita.
   SECURITY DEFINER tem search_path fixo, objetos qualificados e grants
   explícitos. Uma chamada direta à RPC continua sujeita à mesma validação.
4. O Superadmin pode operar sem membership no workspace alvo. Essa exceção
   é da função administrativa validada, não uma policy client-side ampla.
5. Owner/admin comuns jamais alteram roles globais. As políticas e grants de
   user_roles não permitem INSERT/UPDATE/DELETE para authenticated.
6. Registros administrativos guardam ator, alvo, workspace, ação e mudança de
   role; nunca senhas, tokens, chaves ou conteúdo privado do chat.
7. O poder administrativo não conecta mídia, inicia reuniões ou movimenta
   avatares. Acesso às mensagens privadas mantém a regra própria do chat.

## Hardening necessário

- INSERT de membership no cliente: apenas a própria conta como owner de um
  workspace cujo owner_id seja essa conta; convite via RPC validada.
- Convites não podem contornar o hardening: owner/admin local convidam membros
  comuns; convites que concedam admin/owner exigem autorização do Superadmin
  também no servidor. Inventariar convites privilegiados pendentes antes do
  cutover, sem revogação ou promoção em lote silenciosa.
- UPDATE administrativo de membership no cliente: negado.
- DELETE administrativo no cliente: negado; preservar saída própria, com
  proteção de consistência para o proprietário canônico.
- Escritas administrativas continuam pelos handlers/RPCs autorizados.
- Criação de workspace: validar owner_id contra ator nos caminhos de cliente,
  sem ampliar a elegibilidade comercial existente. Criação/atribuição pelo
  Superadmin usa o caminho administrativo próprio.
- Transferência de propriedade: transação server-side sincroniza
  workspaces.owner_id e memberships, sem deixar owners incoerentes.
- Não basta endurecer INSERT: overrides globais antigos nas policies de
  workspaces e outros objetos também precisam deixar de confiar em admin.
  Acesso normal de owner/admin local continua escopado.
- Não modificar RTC, Presence ou a mecânica de gravação. Gates de autorização
  que hoje equiparam roles globais serão inventariados e ajustados por função,
  mantendo permissões operacionais legítimas.

## Inicialização sem perda de acesso

1. Executar inventory.sql somente leitura: conta, roles globais, enum,
   policies, owners e SECURITY DEFINER das funções.
2. Resolver qualquer titular inesperado de privilégios ou ownership incoerente
   antes de atribuir a role. Não transformar todos os admins em Superadmins.
3. Adicionar a label superadmin em migration própria. Usar a nova label apenas
   após commit dessa migration (limitação de enum do PostgreSQL).
4. Atribuir superadmin somente ao UUID validado, com precondições que abortam
   se a conta não existe ou houver outro titular. Recomenda-se índice parcial
   para permitir no máximo um titular nesta fase.
5. Adaptar guards, painéis e operações globais antes do corte de acesso
   legado. Verificar que titular confirmado autentica e conserva cada operação necessária.
6. Retirar overrides globais de admin/master somente com handlers/RPCs
   correspondentes prontos. Não declarar isolamento completo enquanto
   houver caminhos antigos que ainda concedam poder absoluto.
7. Proteger a única conta Superadmin contra remoção/rebaixamento acidental;
   transferência desse privilégio exige procedimento explícito de recuperação.
8. Revisar SQL e diff completo, homologar em ambiente isolado e só então
   solicitar autorização de aplicação/publicação. Nenhuma etapa acima foi
   executada em produção.

## Testes necessários para o desenho novo

- Somente titular confirmado confirmado recebe a atribuição inicial; nenhum auto-upgrade.
- Superadmin opera em workspace sem ser membro, inclusive roles/owners.
- Admin global legado, admin local, owner e membro não passam por guard global.
- Cliente não falsifica ator nem se concede role global.
- Cliente não entra em workspace alheio ou se autopromove.
- Owner/admin não concedem owner/admin indiretamente por convite ou RPC.
- Owner/admin local não administram outro workspace.
- Caminhos de criação, convite, saída própria e administração validados
  funcionam após hardening.
- Convites inválidos, expirados, revogados e de outra conta falham.
- RPCs executam com owners apropriados e sem recursão de RLS.
- Transferência sincroniza owner_id e memberships em uma transação.
- Não há perda do painel nem das capacidades administrativas do Superadmin.
- Office, RTC, Presence e reuniões mantêm os ciclos de vida existentes.

Os testes já criados exercitam somente o candidato anterior de INSERT.
Eles passaram em PostgreSQL isolado; não validam este desenho novo.
