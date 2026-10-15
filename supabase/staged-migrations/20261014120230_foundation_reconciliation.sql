-- Foundation reconciliation: staged, NOT applied; run only with explicit approval.
-- Drizzle 0000-0002 are immutable execution history. No data, roles, policies,
-- memberships, invites, transition flags or audit events are changed here.
BEGIN;
DO $preflight$
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'foundation reconciliation requires trusted postgres';
  END IF;
  -- Same lock order as bootstrap/recovery: singleton -> roles -> Auth.
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM platform_private.transition WHERE singleton
    AND bootstrapped AND NOT membership_hardened AND NOT helpers_hardened AND NOT retired) THEN
    RAISE EXCEPTION 'foundation reconciliation requires post-bootstrap before phase 4';
  END IF;
  LOCK TABLE public.user_roles IN SHARE MODE;
  IF (SELECT count(*) FROM public.user_roles WHERE role='admin')<>1
    OR (SELECT count(*) FROM public.user_roles WHERE role='master')<>1
    OR (SELECT count(*) FROM public.user_roles WHERE role='superadmin')<>1
    OR NOT EXISTS(SELECT 1 FROM public.user_roles a
      JOIN public.user_roles m ON m.user_id=a.user_id AND m.role='master'
      JOIN public.user_roles s ON s.user_id=a.user_id AND s.role='superadmin'
      WHERE a.role='admin')
    OR (SELECT count(*) FROM platform_private.admin_audit WHERE action='superadmin.bootstrap')<>1
    OR EXISTS(SELECT 1 FROM platform_private.admin_audit WHERE action='superadmin.recovery') THEN
    RAISE EXCEPTION 'post-bootstrap inventory changed; reconciliation aborted';
  END IF;
  PERFORM 1 FROM auth.users u JOIN public.user_roles r ON r.user_id=u.id
    WHERE r.role='superadmin' AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Superadmin holder is not active'; END IF;
END $preflight$;

-- Reject unknown COMPLETE definitions (defaults, STRICT, volatility, return
-- shape, parallel/cost/support attributes included), configuration and grants.
-- Normalize only visibility-dependent public type qualification in rendering;
-- exact prosrc is checked separately, so source qualification cannot drift.
-- Do not overwrite unknown definitions automatically.
DO $contracts$
DECLARE unreviewed text;
BEGIN
  WITH approved(signature,canonical_md5,executor_md5,canonical_definition_md5,executor_definition_md5,authenticated_execute,service_execute) AS (
    VALUES
      ('public.platform_recover_superadmin(uuid)','9e8dcf760fb482e0f54e740cc349931a','ceb5f5d893786845e1a259e65cc45972','f05a6829049010899a20e7cdcde230fa','f6b3c78bf056d59ecc49778eef48ab22',false,true),
      ('platform_private.require_cutover_ready()','bcbeee1148aa17cd4005fe92e6100824','0f7ce734b3df838e9f8155399894857d','5fd5034df9798109668eb45792149b3d','9bb793775e587594baad27e1b470a29e',false,false),
      ('public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role)','60eecad14c0e6bc30dfb4a99de637e6e','dd89f7f00ae4cfe0adb87b46f83c4dd9','3939d8f3b7c2f92cf8fe4b4a34b42bef','929ab40fd8d6a75266f6e56b14e754be',true,false),
      ('public.platform_create_workspace_invite(uuid,text,interval)','6e83eb65ce8dcf99cd3f7e76fc4e6722','3cb1ccb45842ff6fe8bb9548b771fd20','4bd7e109b371630ba630f5fa84dce9d0','a389d3260879725f75bd44f9bd250785',true,false)
  )
  SELECT string_agg(a.signature,', ' ORDER BY a.signature) INTO unreviewed
  FROM approved a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  LEFT JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid IS NULL OR md5(p.prosrc) NOT IN(a.canonical_md5,a.executor_md5)
    OR md5(replace(pg_get_functiondef(p.oid),'public.',''))
      NOT IN(a.canonical_definition_md5,a.executor_definition_md5)
    OR p.proowner<>'postgres'::regrole OR p.prokind<>'f' OR NOT p.prosecdef
    OR l.lanname<>'plpgsql' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR has_function_privilege('anon',p.oid,'EXECUTE')
    OR has_function_privilege('authenticated',p.oid,'EXECUTE')<>a.authenticated_execute
    OR has_function_privilege('service_role',p.oid,'EXECUTE')<>a.service_execute;
  IF unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'unreviewed foundation function; reconciliation aborted'
      USING ERRCODE='23514',DETAIL=unreviewed;
  END IF;
END $contracts$;

-- All four lookup bodies already match the approved source: ACL correction only.
DO $helpers$
DECLARE unreviewed text;
BEGIN
  WITH approved(signature,body_md5,definition_md5) AS (VALUES
    ('platform_private.is_superadmin(uuid)','026279fa96749bff335461e7e8fa7ed4','295911f5517ffb34505424bf465c7467'),
    ('platform_private.has_role(uuid,public.app_role)','29214a3dc7effcda7df6117f057dc0ff','fc921854298ff0f74d3236f6614866e7'),
    ('platform_private.is_workspace_member(uuid,uuid)','51d21adb0b7c2b4c03bf443a82165d94','3b467df725fbcef4a85ade6e46d8e97f'),
    ('platform_private.is_workspace_admin(uuid,uuid)','d162652f8b76df8316fb1778cab40a01','ed781fba0da4e7ed736772a62f1f4d83')
  )
  SELECT string_agg(a.signature,', ' ORDER BY a.signature) INTO unreviewed
  FROM approved a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  LEFT JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid IS NULL OR md5(p.prosrc)<>a.body_md5 OR p.prokind<>'f'
    OR md5(replace(pg_get_functiondef(p.oid),'public.',''))<>a.definition_md5
    OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR l.lanname<>'sql'
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[];
  IF unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'unreviewed private helper; reconciliation aborted'
      USING ERRCODE='23514',DETAIL=unreviewed;
  END IF;
END $helpers$;

-- Restore only known executor transformations. Already canonical bodies skip DDL.
DO $restore$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.platform_recover_superadmin(uuid)'::regprocedure)='ceb5f5d893786845e1a259e65cc45972' THEN
    EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.platform_recover_superadmin(replacement uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE old_holder uuid;
BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT (SELECT bootstrapped FROM platform_private.transition WHERE singleton) THEN
    RAISE EXCEPTION 'bootstrap the confirmed intersection before any recovery' USING ERRCODE='23514';
  END IF;
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM auth.users WHERE id=replacement AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery target is not active' USING ERRCODE='23514';
  END IF;
  SELECT user_id INTO old_holder FROM public.user_roles WHERE role='superadmin';
  IF old_holder=replacement THEN
    RAISE EXCEPTION 'target already holds superadmin' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('prestativa.superadmin_maintenance','on',true);
  DELETE FROM public.user_roles WHERE role='superadmin';
  INSERT INTO public.user_roles(user_id,role) VALUES(replacement,'superadmin');
  PERFORM set_config('prestativa.superadmin_maintenance','off',true);
  -- During transition the old application still requires these legacy labels.
  -- Transfer them explicitly in this SERVICE-ONLY emergency procedure, keeping
  -- one privileged holder. After retirement they no longer grant authority.
  IF NOT (SELECT retired FROM platform_private.transition WHERE singleton) THEN
    DELETE FROM public.user_roles WHERE user_id=old_holder AND role IN ('admin','master');
    INSERT INTO public.user_roles(user_id,role) VALUES(replacement,'admin'),(replacement,'master')
      ON CONFLICT DO NOTHING;
  END IF;
  UPDATE platform_private.transition SET bootstrapped=true, acknowledged_by=NULL,
    application_commit=NULL WHERE singleton;
  INSERT INTO platform_private.admin_audit(target_id,action)
    VALUES(replacement,'superadmin.recovery');
  RETURN jsonb_build_object('recovered',true,'superadmin_count',1);
END $$;
$definition$;
  END IF;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='platform_private.require_cutover_ready()'::regprocedure)='0f7ce734b3df838e9f8155399894857d' THEN
    EXECUTE $definition$
CREATE OR REPLACE FUNCTION platform_private.require_cutover_ready()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- Hold to COMMIT of 04+05, excluding a concurrent recovery/attestation.
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM platform_private.transition
    WHERE singleton AND bootstrapped AND application_commit IS NOT NULL
      AND platform_private.is_superadmin(acknowledged_by)) THEN
    RAISE EXCEPTION 'cutover blocked: confirm new access and application rollout first' USING ERRCODE='23514';
  END IF;
END $$;
$definition$;
  END IF;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role)'::regprocedure)='dd89f7f00ae4cfe0adb87b46f83c4dd9' THEN
    EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.platform_transfer_workspace_owner(ws uuid,new_owner uuid,former_role public.workspace_role DEFAULT 'member')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_owner uuid;
BEGIN
  IF NOT public.platform_is_superadmin() THEN RAISE EXCEPTION 'superadmin required' USING ERRCODE='42501'; END IF;
  IF former_role IS NULL OR former_role NOT IN ('admin','member') THEN
    RAISE EXCEPTION 'invalid former owner role' USING ERRCODE='23514';
  END IF;
  SELECT owner_id INTO old_owner FROM public.workspaces WHERE id=ws FOR UPDATE;
  IF NOT FOUND OR old_owner=new_owner THEN RAISE EXCEPTION 'invalid owner transfer' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM auth.users WHERE id=new_owner AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'new owner is not active' USING ERRCODE='23514';
  END IF;
  PERFORM platform_private.check_capacity(ws,new_owner);
  -- Existing tier/plan trigger remains authoritative; failure rolls back all.
  UPDATE public.workspaces SET owner_id=new_owner WHERE id=ws;
  UPDATE public.workspace_members SET role=former_role WHERE workspace_id=ws AND user_id=old_owner;
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,new_owner,'owner')
    ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='owner';
  INSERT INTO platform_private.admin_audit(actor_id,target_id,workspace_id,action,details)
    VALUES(auth.uid(),new_owner,ws,'workspace.owner_transfer',jsonb_build_object('former_role',former_role));
END $$;
$definition$;
  END IF;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.platform_create_workspace_invite(uuid,text,interval)'::regprocedure)='3cb1ccb45842ff6fe8bb9548b771fd20' THEN
    EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.platform_create_workspace_invite(ws uuid,invite_email text DEFAULT NULL,valid_for interval DEFAULT interval '30 days')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE='23514'; END IF;
  PERFORM platform_private.require_membership_manager(ws,NULL,'member');
  IF valid_for IS NULL OR valid_for<=interval '0' OR valid_for>interval '30 days' THEN
    RAISE EXCEPTION 'invalid invite lifetime' USING ERRCODE='23514'; END IF;
  -- Promotions are always explicit management operations, never invitations.
  INSERT INTO public.workspace_invites(workspace_id,email,role,invited_by,expires_at)
    VALUES(ws,invite_email,'member',auth.uid(),now()+valid_for) RETURNING id INTO result;
  RETURN result;
END $$;
$definition$;
  END IF;

END $restore$;

REVOKE EXECUTE ON FUNCTION
  platform_private.is_superadmin(uuid),
  platform_private.has_role(uuid,public.app_role),
  platform_private.is_workspace_member(uuid,uuid),
  platform_private.is_workspace_admin(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA platform_private FROM PUBLIC,anon,authenticated,service_role;

-- Validate every private routine, not only the four repaired helpers. Unknown
-- grants abort the whole transaction; they are not silently revoked here.
DO $private_acl$
DECLARE unexpected text;
BEGIN
  SELECT string_agg(format('%I.%I(%s)',n.nspname,p.proname,
    oidvectortypes(p.proargtypes)),', ' ORDER BY p.oid) INTO unexpected
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='platform_private' AND p.prokind IN ('f','p') AND (
    has_function_privilege('anon',p.oid,'EXECUTE')
    OR has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR has_function_privilege('service_role',p.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE'));
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected private EXECUTE; reconciliation aborted'
      USING ERRCODE='23514',DETAIL=unexpected;
  END IF;
  IF has_schema_privilege('anon','platform_private','USAGE')
    OR has_schema_privilege('authenticated','platform_private','USAGE')
    OR has_schema_privilege('service_role','platform_private','USAGE') THEN
    RAISE EXCEPTION 'private schema USAGE remains; reconciliation aborted';
  END IF;
END $private_acl$;
COMMIT;
