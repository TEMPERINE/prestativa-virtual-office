-- SOMENTE SELECT. Não retorna identificadores nem corpos de funções.
WITH roles_por_usuario AS (
  SELECT user_id, bool_or(role::text='admin') AS admin,
    bool_or(role::text='master') AS master,
    bool_or(role::text='superadmin') AS superadmin
  FROM public.user_roles GROUP BY user_id
), candidato AS (
  SELECT r.user_id FROM roles_por_usuario r JOIN auth.users u ON u.id=r.user_id
  WHERE r.admin AND r.master AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now())
), inventario AS (
  SELECT
    (SELECT count(*) FROM roles_por_usuario WHERE admin) AS usuarios_admin,
    (SELECT count(*) FROM roles_por_usuario WHERE master) AS usuarios_master,
    (SELECT count(*) FROM roles_por_usuario WHERE admin AND master) AS intersecao,
    (SELECT count(*) FROM candidato) AS candidatos_ativos,
    (SELECT count(*) FROM public.user_roles WHERE role::text='superadmin') AS usuarios_superadmin,
    (SELECT count(*) FROM public.workspaces) AS workspaces,
    (SELECT count(*) FROM public.workspace_members WHERE role::text='member') AS memberships_member,
    (SELECT count(*) FROM public.workspace_members WHERE role::text='admin') AS memberships_admin,
    (SELECT count(*) FROM public.workspace_members WHERE role::text='owner') AS memberships_owner,
    (SELECT count(*) FROM public.workspace_invites) AS convites,
    (SELECT count(*) FROM public.workspaces w WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id
        AND m.user_id=w.owner_id AND m.role::text='owner')) AS owners_ausentes,
    (SELECT count(*) FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
      WHERE m.role::text='owner' AND m.user_id<>w.owner_id) AS owners_nao_canonicos
), legado AS (
  SELECT
    (SELECT md5(string_agg(concat(p.polrelid,':',p.polname,':',p.polcmd,':',p.polroles::text,':',
      p.polpermissive,':',p.polqual::text,':',p.polwithcheck::text),E'\n' ORDER BY p.polrelid,p.polname))
     FROM pg_catalog.pg_policy p
     WHERE p.polrelid IN ('public.user_roles'::regclass,'public.workspaces'::regclass,
       'public.workspace_members'::regclass,'public.workspace_invites'::regclass)) AS policies_fingerprint,
    (SELECT md5(string_agg(concat(p.oid,':',p.prosrc,':',p.proowner,':',p.prosecdef,':',
      p.proconfig::text,':',p.proacl::text),E'\n' ORDER BY p.oid))
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN (
       'has_role','is_workspace_admin','is_workspace_member','workspace_accept_invite',
       'can_record_meeting','workspace_members_guard_profile')) AS funcoes_legadas_fingerprint
), ambiente AS (
  SELECT current_user='postgres' AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid IN ('auth.users'::regclass,'public.user_roles'::regclass)
          AND c.relrowsecurity AND NOT (r.rolsuper OR r.rolbypassrls
            OR (c.relowner=r.oid AND NOT c.relforcerowsecurity))
      )
  ) AND has_table_privilege(current_user,'auth.users','TRIGGER')
    AND has_table_privilege(current_user,'public.user_roles','TRIGGER')
    AND has_schema_privilege(current_user,'public','CREATE')
    AND has_database_privilege(current_user,current_database(),'CREATE')
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      JOIN pg_catalog.pg_roles r ON r.rolname=current_user
      WHERE n.nspname='public' AND t.typname='app_role'
        AND (r.rolsuper OR pg_has_role(current_user,t.typowner,'USAGE')))
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=current_user
      WHERE c.oid='public.user_roles'::regclass
        AND (r.rolsuper OR pg_has_role(current_user,c.relowner,'USAGE'))) AS operador_apto,
    EXISTS (SELECT 1 FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
      JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname='app_role' AND e.enumlabel='superadmin') AS enum_superadmin,
    to_regnamespace('platform_private') IS NULL AS schema_privado_ausente,
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND left(p.proname,9)='platform_') AS rpcs_platform_ausentes
)
SELECT a.*, i.*, l.*,
  (a.operador_apto AND a.enum_superadmin=false
    AND a.schema_privado_ausente AND a.rpcs_platform_ausentes
    AND i.usuarios_superadmin=0 AND i.usuarios_admin=1 AND i.usuarios_master=1 AND i.intersecao=1
    AND i.candidatos_ativos=1 AND i.workspaces=1 AND i.memberships_member=17
    AND i.memberships_admin=0 AND i.memberships_owner=1 AND i.convites=0
    AND i.owners_ausentes=0 AND i.owners_nao_canonicos=0) AS validacao_ok
FROM ambiente a CROSS JOIN inventario i CROSS JOIN legado l;
