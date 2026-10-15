-- Pré-reconciliação: aceita somente transformações conhecidas e ACL dos quatro helpers.
-- Contrato de definição completa: defaults/STRICT/volatilidade incluídos.
-- SOMENTE SELECT, executado como postgres. Nenhum identificador no resultado.
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
), esperadas(assinatura,corpo_md5,definicao_md5,linguagem,definer,authenticated_execute,service_execute) AS (
  VALUES
    ('platform_private.is_superadmin(uuid)','026279fa96749bff335461e7e8fa7ed4','295911f5517ffb34505424bf465c7467','sql',true,false,false),
    ('platform_private.protect_superadmin_role()','5de77cfacd30315a5787c7b11a321287','e4318e15e8597d1c7c1ad8ecfbd11d9a','plpgsql',false,false,false),
    ('platform_private.protect_superadmin_truncate()','367e952a2c97b5d6a5c2c8a5fb3ed4c2','ceeb94cec2316a5f7d5a2c80928f079c','plpgsql',true,false,false),
    ('platform_private.protect_superadmin_account()','bae359b319c4dad5be94d61f2f2bf1ae','355f3addd08478fe7cc676cfa047d564','plpgsql',true,false,false),
    ('platform_private.require_cutover_ready()','bcbeee1148aa17cd4005fe92e6100824','5fd5034df9798109668eb45792149b3d','plpgsql',true,false,false),
    ('platform_private.has_role(uuid,public.app_role)','29214a3dc7effcda7df6117f057dc0ff','fc921854298ff0f74d3236f6614866e7','sql',true,false,false),
    ('platform_private.is_workspace_member(uuid,uuid)','51d21adb0b7c2b4c03bf443a82165d94','3b467df725fbcef4a85ade6e46d8e97f','sql',true,false,false),
    ('platform_private.is_workspace_admin(uuid,uuid)','d162652f8b76df8316fb1778cab40a01','ed781fba0da4e7ed736772a62f1f4d83','sql',true,false,false),
    ('platform_private.require_membership_manager(uuid,uuid,public.workspace_role)','674e922a9732825e1fa9432fe81ac388','84226ef7c0f8cf6264a336bf8fdda324','plpgsql',true,false,false),
    ('platform_private.check_capacity(uuid,uuid)','0e2d7bcca205548e9df0b85ab44669ca','a4005b1d3d7a57c82b468c4096a65016','plpgsql',true,false,false),
    ('public.platform_is_superadmin()','1d7133e1c8a5a64e7e0949af433de917','73dcc6d2fc8cf8c534802d413ace6ee0','sql',true,true,false),
    ('public.platform_bootstrap_superadmin()','90db0a3d1c05b421e7fda7a7d75c870e','df1ef6e959819c49dd4daf2ca69c0b68','plpgsql',true,false,true),
    ('public.platform_recover_superadmin(uuid)','9e8dcf760fb482e0f54e740cc349931a','f05a6829049010899a20e7cdcde230fa','plpgsql',true,false,true),
    ('public.platform_acknowledge_superadmin_access()','032404567e9dd84865e0ef8b9e8555ad','39e7b7fa25f18455f9e665132aaa4613','plpgsql',true,true,false),
    ('public.platform_authorize_cutover(text)','4f4bf5d5b182f0d6ebb9c9674cae0d89','f62a8edaf71fec1de05f64eacce14b62','plpgsql',true,false,true),
    ('public.platform_set_global_role(uuid,public.app_role,boolean)','071f6df901039a3f478c37e54c313391','422ac2023cfe12fcef4393b5997ce3a2','plpgsql',true,true,false),
    ('public.platform_set_workspace_member(uuid,uuid,public.workspace_role)','78c9318d3fc620d7feb24d85f9c9d33c','7c6eab47386ef7e3e8b38158287c626d','plpgsql',true,true,false),
    ('public.platform_remove_workspace_member(uuid,uuid)','ce0e492f365d9c51fb48279c3c514378','71100e4442f618a359d9ed03fd0f77a7','plpgsql',true,true,false),
    ('public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role)','60eecad14c0e6bc30dfb4a99de637e6e','3939d8f3b7c2f92cf8fe4b4a34b42bef','plpgsql',true,true,false),
    ('public.platform_set_member_profile(uuid,uuid,text)','291400fac57500340f70af9516251b0e','4b6d0da26102a21f90311f71717a99ff','plpgsql',true,true,false),
    ('public.platform_create_workspace(text,text,uuid,smallint)','b665c6a5f7c646a14f71088a1ca3559a','2754f10e87fef770d51b0b16bc0d5580','plpgsql',true,true,false),
    ('public.platform_create_workspace_invite(uuid,text,interval)','6e83eb65ce8dcf99cd3f7e76fc4e6722','4bd7e109b371630ba630f5fa84dce9d0','plpgsql',true,true,false),
    ('public.platform_revoke_workspace_invite(uuid)','c8256dfaa69410deea075439bd896f46','8e323ee3c9f95f56a80c020e27d31c86','plpgsql',true,true,false),
    ('public.platform_assign_workspace_member(uuid,uuid,public.workspace_role,text)','61bf2835af9a53a40d1330d2e5e7b8f7','3c90c249ac1b33639ca452494ff9027f','plpgsql',true,true,false),
    ('public.platform_update_workspace(uuid,text,smallint,uuid)','d380d695c015fb35834a136624daa8a0','843d4d44329dff8b5134f8484a5b1a56','plpgsql',true,true,false)
), contratos AS (
  SELECT count(*) AS funcoes_esperadas,
    count(p.oid) AS funcoes_encontradas,
    count(*) FILTER (WHERE p.proowner='postgres'::regrole AND p.prokind='f'
      AND p.prosecdef=e.definer AND lang.lanname=e.linguagem

      AND (md5(replace(pg_get_functiondef(p.oid),'public.',''))=e.definicao_md5 OR (e.definicao_md5,md5(replace(pg_get_functiondef(p.oid),'public.',''))) IN (('5fd5034df9798109668eb45792149b3d','9bb793775e587594baad27e1b470a29e'),('f05a6829049010899a20e7cdcde230fa','f6b3c78bf056d59ecc49778eef48ab22'),('3939d8f3b7c2f92cf8fe4b4a34b42bef','929ab40fd8d6a75266f6e56b14e754be'),('4bd7e109b371630ba630f5fa84dce9d0','a389d3260879725f75bd44f9bd250785')))
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND (md5(p.prosrc)=e.corpo_md5 OR (e.corpo_md5,md5(p.prosrc)) IN (
      ('9e8dcf760fb482e0f54e740cc349931a','ceb5f5d893786845e1a259e65cc45972'),
      ('bcbeee1148aa17cd4005fe92e6100824','0f7ce734b3df838e9f8155399894857d'),
      ('60eecad14c0e6bc30dfb4a99de637e6e','dd89f7f00ae4cfe0adb87b46f83c4dd9'),
      ('6e83eb65ce8dcf99cd3f7e76fc4e6722','3cb1ccb45842ff6fe8bb9548b771fd20')))
      AND (NOT has_function_privilege('anon',p.oid,'EXECUTE') OR e.assinatura IN ('platform_private.is_superadmin(uuid)','platform_private.has_role(uuid,public.app_role)','platform_private.is_workspace_member(uuid,uuid)','platform_private.is_workspace_admin(uuid,uuid)'))
      AND (has_function_privilege('authenticated',p.oid,'EXECUTE')=e.authenticated_execute OR e.assinatura IN ('platform_private.is_superadmin(uuid)','platform_private.has_role(uuid,public.app_role)','platform_private.is_workspace_member(uuid,uuid)','platform_private.is_workspace_admin(uuid,uuid)'))
      AND (has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_execute OR e.assinatura IN ('platform_private.is_superadmin(uuid)','platform_private.has_role(uuid,public.app_role)','platform_private.is_workspace_member(uuid,uuid)','platform_private.is_workspace_admin(uuid,uuid)'))) AS contratos_conhecidos_ok
  FROM esperadas e LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(e.assinatura)
  LEFT JOIN pg_catalog.pg_language lang ON lang.oid=p.prolang
), acl_privada AS (
  SELECT count(*) AS rotinas_privadas,
    count(*) FILTER(WHERE has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR has_function_privilege('service_role',p.oid,'EXECUTE')
      OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) AS rotinas_com_execute_cliente,
    count(*) FILTER(WHERE (has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR has_function_privilege('service_role',p.oid,'EXECUTE')
      OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
      AND p.oid NOT IN(
        to_regprocedure('platform_private.is_superadmin(uuid)'),
        to_regprocedure('platform_private.has_role(uuid,public.app_role)'),
        to_regprocedure('platform_private.is_workspace_member(uuid,uuid)'),
        to_regprocedure('platform_private.is_workspace_admin(uuid,uuid)'))) AS execute_inesperado,
    NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r(role)
      WHERE has_schema_privilege(role,'platform_private','USAGE')
        OR has_schema_privilege(role,'platform_private','CREATE')) AS schema_privado_isolado
  FROM pg_proc p WHERE p.pronamespace='platform_private'::regnamespace AND p.prokind IN('f','p')
), protecoes AS (
  SELECT
    (SELECT count(*) FROM (VALUES
      ('public.user_roles','user_roles_protect_superadmin','platform_private.protect_superadmin_role()',31),
      ('public.user_roles','user_roles_protect_superadmin_truncate','platform_private.protect_superadmin_truncate()',34),
      ('auth.users','auth_users_protect_superadmin','platform_private.protect_superadmin_account()',27),
      ('auth.users','auth_users_protect_superadmin_truncate','platform_private.protect_superadmin_truncate()',34)
    ) esperado(tabela,nome,funcao,tipo)
    JOIN pg_catalog.pg_trigger t ON t.tgrelid=to_regclass(esperado.tabela)
      AND t.tgname=esperado.nome AND t.tgfoid=to_regprocedure(esperado.funcao)
      AND t.tgtype=esperado.tipo AND NOT t.tgisinternal AND t.tgenabled='O') AS triggers_ativos,
    EXISTS (SELECT 1 FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='user_roles_one_superadmin'
        AND x.indrelid='public.user_roles'::regclass AND x.indisunique AND x.indisvalid
        AND x.indnatts=1 AND pg_get_indexdef(x.indexrelid,1,true)='role'
        AND strpos(pg_get_expr(x.indpred,x.indrelid),quote_literal('superadmin'))>0) AS indice_singleton_ok,
    NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS papeis(papel)
      WHERE has_schema_privilege(papel,'platform_private','USAGE')
        OR has_table_privilege(papel,'platform_private.transition','SELECT')
        OR has_table_privilege(papel,'platform_private.admin_audit','SELECT')) AS objetos_privados_isolados,
    NOT has_function_privilege('anon','public.platform_recover_superadmin(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.platform_recover_superadmin(uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.platform_recover_superadmin(uuid)','EXECUTE') AS recuperacao_service_only,
    NOT has_table_privilege('authenticated','public.user_roles','TRUNCATE')
      AND NOT has_table_privilege('anon','public.user_roles','TRUNCATE')
      AND NOT has_table_privilege('service_role','public.user_roles','TRUNCATE') AS truncate_roles_bloqueado
), estado AS (
  SELECT count(*) AS linhas_estado,
    bool_and(singleton) AS singleton_ok,
    bool_and(NOT membership_hardened AND NOT helpers_hardened AND NOT retired
      AND acknowledged_by IS NULL AND application_commit IS NULL) AS somente_preparacao,
    bool_and(bootstrapped) AS bootstrap_concluido,
    (SELECT count(*) FROM platform_private.admin_audit) AS eventos_auditoria,
    (SELECT count(*) FROM platform_private.admin_audit WHERE action='superadmin.bootstrap') AS eventos_bootstrap
  FROM platform_private.transition
), titular AS (
  SELECT EXISTS (SELECT 1 FROM candidato c JOIN public.user_roles r ON r.user_id=c.user_id
    WHERE r.role::text='superadmin' AND platform_private.is_superadmin(c.user_id)) AS titular_e_intersecao_ativa
)
SELECT current_user='postgres' AS operador_postgres, i.*, l.*, c.*, p.*, e.*, t.*, a.*,
  (current_user='postgres' AND i.usuarios_admin=1 AND i.usuarios_master=1 AND i.intersecao=1
    AND i.candidatos_ativos=1 AND i.workspaces=1 AND i.memberships_member=17
    AND i.memberships_admin=0 AND i.memberships_owner=1 AND i.convites=0
    AND i.owners_ausentes=0 AND i.owners_nao_canonicos=0
    AND a.rotinas_privadas=10 AND a.schema_privado_isolado
    AND a.execute_inesperado=0
    AND c.funcoes_esperadas=25 AND c.funcoes_encontradas=25 AND c.contratos_conhecidos_ok=25
    AND p.triggers_ativos=4 AND p.indice_singleton_ok AND p.objetos_privados_isolados
    AND p.recuperacao_service_only AND p.truncate_roles_bloqueado
    AND e.linhas_estado=1 AND e.singleton_ok AND e.somente_preparacao
    AND i.usuarios_superadmin=1 AND e.bootstrap_concluido
    AND e.eventos_auditoria=1 AND e.eventos_bootstrap=1 AND t.titular_e_intersecao_ativa) AS validacao_ok
FROM inventario i CROSS JOIN legado l CROSS JOIN contratos c CROSS JOIN protecoes p
CROSS JOIN estado e CROSS JOIN titular t CROSS JOIN acl_privada a;
