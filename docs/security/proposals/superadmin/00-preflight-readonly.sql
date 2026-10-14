-- READ ONLY, execute in authorized SQL Editor. Metadata/counts only; no UUIDs,
-- email addresses, tokens, function bodies or policy expressions are returned.
WITH roles AS (
 SELECT user_id,bool_or(role::text='admin') AS admin,bool_or(role::text='master') AS master
 FROM public.user_roles GROUP BY user_id
)
SELECT count(*) FILTER(WHERE admin) AS usuarios_admin,
 count(*) FILTER(WHERE master) AS usuarios_master,
 count(*) FILTER(WHERE admin AND master) AS usuarios_com_admin_e_master,
 count(*) FILTER(WHERE admin AND NOT master) AS somente_admin,
 count(*) FILTER(WHERE master AND NOT admin) AS somente_master FROM roles;

-- All labels of the unique intersection, without identifying the account.
WITH candidates AS (
 SELECT user_id FROM public.user_roles WHERE role::text IN ('admin','master')
 GROUP BY user_id HAVING count(DISTINCT role)=2
)
SELECT role::text AS role_da_conta_confirmada FROM public.user_roles
WHERE user_id IN (SELECT user_id FROM candidates)
  AND (SELECT count(*) FROM candidates)=1 ORDER BY role::text;

SELECT p.oid::regprocedure::text AS funcao,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer,r.rolsuper,r.rolbypassrls,
 ARRAY(SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS search_path,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 p.prosrc ILIKE '%''admin''%' AS menciona_admin,
 p.prosrc ILIKE '%''master''%' AS menciona_master
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
WHERE n.nspname='public' AND p.prokind='f'
 AND (p.prosrc ILIKE '%has_role%' OR p.prosrc ILIKE '%user_roles%'
   OR p.prosrc ILIKE '%is_workspace_admin%' OR p.proname IN ('workspace_accept_invite','signup_invite_redeem'))
ORDER BY funcao;

SELECT schemaname,tablename,policyname,roles,cmd,permissive,
 COALESCE(qual,'') ILIKE '%has_role%' OR COALESCE(with_check,'') ILIKE '%has_role%' AS consulta_role_global,
 COALESCE(qual,'')~* '''admin''' OR COALESCE(with_check,'')~* '''admin''' AS menciona_admin,
 COALESCE(qual,'')~* '''master''' OR COALESCE(with_check,'')~* '''master''' AS menciona_master
FROM pg_policies WHERE schemaname IN ('public','storage')
 AND (tablename IN ('user_roles','workspaces','workspace_members','workspace_invites','signup_invites')
 OR COALESCE(qual,'')~* '(has_role|is_workspace_admin)'
 OR COALESCE(with_check,'')~* '(has_role|is_workspace_admin)')
ORDER BY schemaname,tablename,policyname;

SELECT n.nspname AS schema,c.relname AS tabela,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='auth' AND c.relname='users')
 OR (n.nspname='public' AND c.relname IN ('user_roles','workspaces','workspace_members','workspace_invites','signup_invites','profiles'))
ORDER BY schema,tabela;
SELECT column_name,data_type FROM information_schema.columns
WHERE table_schema='auth' AND table_name='users' AND column_name IN ('deleted_at','banned_until');

SELECT count(*) AS memberships_owner_nao_canonicas FROM public.workspace_members m
JOIN public.workspaces w ON w.id=m.workspace_id WHERE m.role='owner' AND m.user_id<>w.owner_id;
SELECT count(*) AS workspaces_sem_membership_owner FROM public.workspaces w
WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner');
SELECT role::text AS role,count(*) AS convites_privilegiados_pendentes FROM public.workspace_invites
WHERE role<>'member' AND expires_at>now() AND uses<max_uses GROUP BY role;
SELECT role::text AS role_local,member_profile,count(*) AS memberships
FROM public.workspace_members GROUP BY role,member_profile ORDER BY role::text,member_profile;
