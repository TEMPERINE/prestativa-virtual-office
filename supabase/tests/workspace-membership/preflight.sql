-- READ ONLY. Run in the actual target DB before approving the migration.
SELECT p.oid::regprocedure AS function_name,
       pg_get_userbyid(p.proowner) AS function_owner,
       p.prosecdef AS security_definer,
       ARRAY(SELECT setting FROM unnest(p.proconfig) AS setting
             WHERE setting LIKE 'search_path=%') AS search_path_config,
       r.rolsuper, r.rolbypassrls,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS client_can_execute
FROM pg_proc p
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.oid IN (
  to_regprocedure('public.workspace_accept_invite(text)'),
  to_regprocedure('public.is_workspace_admin(uuid,uuid)'),
  to_regprocedure('public.is_workspace_member(uuid,uuid)')
);

SELECT c.oid::regclass AS table_name,
       pg_get_userbyid(c.relowner) AS table_owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
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
