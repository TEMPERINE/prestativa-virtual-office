-- READ ONLY: review-only inventory, never run as a migration.
-- Execute queries separately in an authorized SQL editor. No personal identifier
-- is stored here. Set the target only in the PRIVATE runtime session, outside Git.
-- With no runtime target, the second query returns no rows: that is not evidence
-- of missing roles. Do not share the target setting or any credentials.

SELECT
  COUNT(DISTINCT user_id) FILTER (WHERE role::text='admin') AS usuarios_admin,
  COUNT(DISTINCT user_id) FILTER (WHERE role::text='master') AS usuarios_master
FROM public.user_roles;

SELECT role::text AS role_global
FROM public.user_roles
WHERE user_id=NULLIF(current_setting('prestativa.audit_target_user',true),'')::uuid
ORDER BY role::text;

-- Candidates for manual review, not proof that every role mention is an override.
SELECT p.oid::regprocedure::text AS function_name,
       pg_get_userbyid(p.proowner) AS function_owner,
       p.prosecdef AS security_definer,
       r.rolsuper,r.rolbypassrls,
       EXISTS(SELECT 1 FROM unnest(p.proconfig) AS setting
              WHERE setting LIKE 'search_path=%') AS fixed_search_path,
       p.prosrc ILIKE '%has_role%' AS checks_global_role,
       p.prosrc ILIKE '%''admin''%' AS mentions_admin,
       p.prosrc ILIKE '%''master''%' AS mentions_master
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_roles r ON r.oid=p.proowner
WHERE n.nspname='public' AND p.prokind IN ('f','p')
  AND (p.prosrc ILIKE '%has_role%' OR p.prosrc ILIKE '%user_roles%'
       OR p.prosrc ILIKE '%is_workspace_admin%'
       OR p.proname='workspace_accept_invite')
ORDER BY function_name;

SELECT c.oid::regclass::text AS table_name,
       pg_get_userbyid(c.relowner) AS table_owner,
       c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls
FROM pg_class c
WHERE c.oid IN ('public.workspace_members'::regclass,
               'public.workspaces'::regclass,
               'public.workspace_invites'::regclass);

-- Mask UUID/email literals in policy expressions before sharing results.
SELECT tablename,policyname,roles,cmd,
       regexp_replace(regexp_replace(COALESCE(qual,''),
         '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}',
         '[ID OMITIDO]','gi'),
         '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
         '[EMAIL OMITIDO]','g') AS qual_redacted,
       regexp_replace(regexp_replace(COALESCE(with_check,''),
         '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}',
         '[ID OMITIDO]','gi'),
         '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
         '[EMAIL OMITIDO]','g') AS with_check_redacted
FROM pg_policies
WHERE schemaname='public'
  AND (tablename IN ('user_roles','workspace_members','workspaces')
       OR COALESCE(qual,'') ILIKE '%has_role%'
       OR COALESCE(with_check,'') ILIKE '%has_role%'
       OR COALESCE(qual,'') ILIKE '%is_workspace_admin%'
       OR COALESCE(with_check,'') ILIKE '%is_workspace_admin%')
ORDER BY tablename,policyname;
