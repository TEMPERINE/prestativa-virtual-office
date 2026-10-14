-- Phase 2: additive infrastructure/RPCs; no assignment or legacy retirement.
BEGIN;
DO $$ BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'review trusted postgres ownership before installing this proposal';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS platform_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS platform_private.transition (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  bootstrapped boolean NOT NULL DEFAULT false,
  acknowledged_by uuid,
  application_commit text,
  membership_hardened boolean NOT NULL DEFAULT false,
  helpers_hardened boolean NOT NULL DEFAULT false,
  retired boolean NOT NULL DEFAULT false
);
INSERT INTO platform_private.transition DEFAULT VALUES ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS platform_private.admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  target_id uuid,
  workspace_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;
-- Exactly one assignment; recovery replaces it atomically rather than banning
-- the old account and making a second assignment.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_superadmin ON public.user_roles(role)
  WHERE role = 'superadmin';

CREATE OR REPLACE FUNCTION platform_private.is_superadmin(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id=r.user_id
    WHERE r.user_id=uid AND r.role='superadmin'
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
  )
$$;
CREATE OR REPLACE FUNCTION public.platform_is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT platform_private.is_superadmin(auth.uid())
$$;

-- INVOKER is intentional: inside the privileged functions current_user is
-- their trusted owner, while a client cannot forge that identity using a GUC.
CREATE OR REPLACE FUNCTION platform_private.protect_superadmin_role()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.role='superadmin')
     OR (TG_OP <> 'DELETE' AND NEW.role='superadmin') THEN
    IF current_user <> 'postgres'
       OR COALESCE(current_setting('prestativa.superadmin_maintenance', true),'') <> 'on' THEN
      RAISE EXCEPTION 'superadmin assignment requires controlled recovery' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS user_roles_protect_superadmin ON public.user_roles;
CREATE TRIGGER user_roles_protect_superadmin
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION platform_private.protect_superadmin_role();
-- TRUNCATE bypasses RLS and row triggers, including FK cascade protection.
REVOKE TRUNCATE ON public.user_roles FROM service_role,authenticated,anon,PUBLIC;
CREATE OR REPLACE FUNCTION platform_private.protect_superadmin_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role='superadmin') THEN
    RAISE EXCEPTION 'recover superadmin before truncating protected tables' USING ERRCODE='42501';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS user_roles_protect_superadmin_truncate ON public.user_roles;
CREATE TRIGGER user_roles_protect_superadmin_truncate
BEFORE TRUNCATE ON public.user_roles
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.protect_superadmin_truncate();
DROP TRIGGER IF EXISTS auth_users_protect_superadmin_truncate ON auth.users;
CREATE TRIGGER auth_users_protect_superadmin_truncate
BEFORE TRUNCATE ON auth.users
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.protect_superadmin_truncate();

CREATE OR REPLACE FUNCTION platform_private.protect_superadmin_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=OLD.id AND role='superadmin') THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'recover superadmin before deleting this account' USING ERRCODE='42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.deleted_at IS NOT NULL
       OR NEW.banned_until > now() THEN
      RAISE EXCEPTION 'recover superadmin before disabling this account' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS auth_users_protect_superadmin ON auth.users;
CREATE TRIGGER auth_users_protect_superadmin
BEFORE UPDATE OR DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION platform_private.protect_superadmin_account();

CREATE OR REPLACE FUNCTION public.platform_bootstrap_superadmin()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE candidate uuid; admins integer; masters integer; intersection_count integer;
BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT bootstrapped FROM platform_private.transition WHERE singleton)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE role='superadmin') THEN
    RAISE EXCEPTION 'bootstrap already performed; use controlled recovery' USING ERRCODE='23514';
  END IF;
  SELECT count(DISTINCT user_id) FILTER (WHERE role='admin'),
         count(DISTINCT user_id) FILTER (WHERE role='master')
    INTO admins, masters FROM public.user_roles;
  SELECT count(*) INTO intersection_count FROM public.user_roles a
    JOIN public.user_roles m ON m.user_id=a.user_id AND m.role='master'
    WHERE a.role='admin';
  IF admins<>1 OR masters<>1 OR intersection_count<>1 THEN
    RAISE EXCEPTION 'role inventory changed; bootstrap aborted' USING ERRCODE='23514';
  END IF;
  SELECT a.user_id INTO candidate FROM public.user_roles a
    JOIN public.user_roles m ON m.user_id=a.user_id AND m.role='master'
    JOIN auth.users u ON u.id=a.user_id
    WHERE a.role='admin' AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR UPDATE OF u;
  IF candidate IS NULL THEN
    RAISE EXCEPTION 'bootstrap candidate is not active' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('prestativa.superadmin_maintenance','on',true);
  INSERT INTO public.user_roles(user_id,role) VALUES(candidate,'superadmin');
  PERFORM set_config('prestativa.superadmin_maintenance','off',true);
  UPDATE platform_private.transition SET bootstrapped=true WHERE singleton;
  INSERT INTO platform_private.admin_audit(target_id,action) VALUES(candidate,'superadmin.bootstrap');
  RETURN jsonb_build_object('assigned',true,'superadmin_count',1);
END $$;

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

CREATE OR REPLACE FUNCTION public.platform_acknowledge_superadmin_access()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.platform_is_superadmin() THEN
    RAISE EXCEPTION 'superadmin required' USING ERRCODE='42501';
  END IF;
  UPDATE platform_private.transition SET acknowledged_by=auth.uid() WHERE singleton;
  RETURN jsonb_build_object('superadmin',true,'legacy_retired',
    (SELECT retired FROM platform_private.transition WHERE singleton));
END $$;

-- Operator attestation, NOT automated proof that the UI was tested. Call only
-- after recorded access/guard/UI homologation at this exact application commit.
CREATE OR REPLACE FUNCTION public.platform_authorize_cutover(application_commit text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF application_commit !~ '^[0-9a-f]{40}$' OR application_commit IS NULL THEN
    RAISE EXCEPTION 'exact application commit required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_private.transition
                  WHERE singleton AND bootstrapped
                    AND platform_private.is_superadmin(acknowledged_by)) THEN
    RAISE EXCEPTION 'new access has not been acknowledged' USING ERRCODE='23514';
  END IF;
  UPDATE platform_private.transition SET application_commit=platform_authorize_cutover.application_commit
    WHERE singleton;
END $$;

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

ALTER FUNCTION public.platform_bootstrap_superadmin() OWNER TO postgres;
ALTER FUNCTION public.platform_recover_superadmin(uuid) OWNER TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_bootstrap_superadmin(),
  public.platform_recover_superadmin(uuid), public.platform_authorize_cutover(text),
  public.platform_is_superadmin(), public.platform_acknowledge_superadmin_access()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_bootstrap_superadmin(),
  public.platform_recover_superadmin(uuid), public.platform_authorize_cutover(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_is_superadmin(),
  public.platform_acknowledge_superadmin_access() TO authenticated;


CREATE OR REPLACE FUNCTION platform_private.has_role(uid uuid, requested public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=uid AND role=requested)
$$;
CREATE OR REPLACE FUNCTION platform_private.is_workspace_member(ws uuid, uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=uid)
$$;
CREATE OR REPLACE FUNCTION platform_private.is_workspace_admin(ws uuid, uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=uid AND role IN ('owner','admin'))
$$;

CREATE OR REPLACE FUNCTION public.platform_set_global_role(target uuid,new_role public.app_role,enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.platform_is_superadmin() THEN RAISE EXCEPTION 'superadmin required' USING ERRCODE='42501'; END IF;
  IF new_role IS NULL OR new_role='superadmin' OR enabled IS NULL THEN
    RAISE EXCEPTION 'superadmin assignment requires controlled recovery' USING ERRCODE='42501'; END IF;
  IF NOT (SELECT retired FROM platform_private.transition WHERE singleton)
     AND target=auth.uid() AND new_role IN ('admin','master') AND NOT enabled THEN
    RAISE EXCEPTION 'retain legacy access until cutover' USING ERRCODE='42501'; END IF;
  IF NOT (SELECT retired FROM platform_private.transition WHERE singleton)
     AND new_role IN ('admin','master') AND enabled AND target<>auth.uid() THEN
    RAISE EXCEPTION 'do not extend legacy privilege before retirement' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=target) THEN
    RAISE EXCEPTION 'account not found' USING ERRCODE='23514'; END IF;
  IF enabled THEN
    INSERT INTO public.user_roles(user_id,role) VALUES(target,new_role) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.user_roles WHERE user_id=target AND role=new_role;
  END IF;
  INSERT INTO platform_private.admin_audit(actor_id,target_id,action,details)
    VALUES(auth.uid(),target,'role.global',jsonb_build_object('role',new_role,'enabled',enabled));
END $$;
CREATE OR REPLACE FUNCTION platform_private.require_membership_manager(ws uuid, target uuid, new_role public.workspace_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing_role public.workspace_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account inactive' USING ERRCODE='42501'; END IF;
  IF public.platform_is_superadmin() THEN RETURN; END IF;
  IF NOT (SELECT membership_hardened FROM platform_private.transition WHERE singleton)
     OR NOT platform_private.is_workspace_admin(ws,auth.uid()) THEN
    RAISE EXCEPTION 'workspace administration denied' USING ERRCODE='42501';
  END IF;
  SELECT role INTO existing_role FROM public.workspace_members WHERE workspace_id=ws AND user_id=target;
  IF new_role IS DISTINCT FROM 'member'::public.workspace_role
     OR existing_role IN ('owner','admin')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=target AND role='superadmin') THEN
    RAISE EXCEPTION 'privileged member is protected' USING ERRCODE='42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION platform_private.check_capacity(ws uuid, target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE limit_count integer; actual_count integer;
BEGIN
  SELECT CASE tier WHEN 1 THEN 2 WHEN 2 THEN 5 ELSE 2147483647 END
    INTO limit_count FROM public.workspaces WHERE id=ws;
  SELECT count(*) INTO actual_count FROM public.workspace_members WHERE workspace_id=ws;
  IF actual_count>=limit_count AND NOT platform_private.is_workspace_member(ws,target) THEN
    RAISE EXCEPTION 'workspace member limit reached' USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_workspace_member(ws uuid,target uuid,new_role public.workspace_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE canonical_owner uuid;
BEGIN
  SELECT owner_id INTO canonical_owner FROM public.workspaces WHERE id=ws FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE='23514'; END IF;
  PERFORM platform_private.require_membership_manager(ws,target,new_role);
  IF new_role IS NULL OR (new_role='owner' AND target<>canonical_owner)
     OR (target=canonical_owner AND new_role<>'owner') THEN
    RAISE EXCEPTION 'use explicit owner transfer' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM auth.users WHERE id=target AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target is not active' USING ERRCODE='23514';
  END IF;
  PERFORM platform_private.check_capacity(ws,target);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,target,new_role)
    ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role;
  INSERT INTO platform_private.admin_audit(actor_id,target_id,workspace_id,action,details)
    VALUES(auth.uid(),target,ws,'membership.set',jsonb_build_object('role',new_role));
END $$;

CREATE OR REPLACE FUNCTION public.platform_remove_workspace_member(ws uuid,target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE canonical_owner uuid;
BEGIN
  SELECT owner_id INTO canonical_owner FROM public.workspaces WHERE id=ws FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE='23514'; END IF;
  PERFORM platform_private.require_membership_manager(ws,target,'member');
  IF target=canonical_owner THEN
    RAISE EXCEPTION 'transfer ownership before removing owner' USING ERRCODE='23514';
  END IF;
  DELETE FROM public.workspace_members WHERE workspace_id=ws AND user_id=target;
  INSERT INTO platform_private.admin_audit(actor_id,target_id,workspace_id,action)
    VALUES(auth.uid(),target,ws,'membership.remove');
END $$;

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

CREATE OR REPLACE FUNCTION public.platform_set_member_profile(ws uuid,target uuid,new_profile text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR UPDATE;
  PERFORM platform_private.require_membership_manager(ws,target,'member');
  IF new_profile IS NULL OR new_profile NOT IN ('operational','strategic') THEN
    RAISE EXCEPTION 'invalid member profile' USING ERRCODE='23514'; END IF;
  UPDATE public.workspace_members SET member_profile=new_profile WHERE workspace_id=ws AND user_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership not found' USING ERRCODE='23514'; END IF;
  INSERT INTO platform_private.admin_audit(actor_id,target_id,workspace_id,action,details)
    VALUES(auth.uid(),target,ws,'membership.profile',jsonb_build_object('profile',new_profile));
END $$;

CREATE OR REPLACE FUNCTION public.platform_create_workspace(ws_slug text,ws_name text,owner uuid,ws_tier smallint DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;
BEGIN
  IF NOT public.platform_is_superadmin() THEN RAISE EXCEPTION 'superadmin required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM auth.users WHERE id=owner AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner is not active' USING ERRCODE='23514'; END IF;
  INSERT INTO public.workspaces(slug,name,owner_id,tier) VALUES(ws_slug,ws_name,owner,ws_tier) RETURNING id INTO ws;
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,owner,'owner');
  INSERT INTO platform_private.admin_audit(actor_id,target_id,workspace_id,action)
    VALUES(auth.uid(),owner,ws,'workspace.create');
  RETURN ws;
END $$;

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

CREATE OR REPLACE FUNCTION public.platform_revoke_workspace_invite(invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;
BEGIN
  SELECT workspace_id INTO ws FROM public.workspace_invites WHERE id=invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR UPDATE;
  PERFORM platform_private.require_membership_manager(ws,NULL,'member');
  DELETE FROM public.workspace_invites WHERE id=invite_id AND workspace_id=ws;
END $$;

CREATE OR REPLACE FUNCTION public.platform_assign_workspace_member(ws uuid,target uuid,new_role public.workspace_role,new_profile text DEFAULT 'operational')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.platform_set_workspace_member(ws,target,new_role);
  PERFORM public.platform_set_member_profile(ws,target,
    CASE WHEN new_role='member' THEN new_profile ELSE 'operational' END);
END $$;
CREATE OR REPLACE FUNCTION public.platform_update_workspace(ws uuid,new_name text DEFAULT NULL,new_tier smallint DEFAULT NULL,new_owner uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_owner uuid;
BEGIN
  IF NOT public.platform_is_superadmin() THEN RAISE EXCEPTION 'superadmin required' USING ERRCODE='42501'; END IF;
  SELECT owner_id INTO old_owner FROM public.workspaces WHERE id=ws FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE='23514'; END IF;
  IF new_name IS NOT NULL AND length(btrim(new_name))<2 THEN
    RAISE EXCEPTION 'workspace name too short' USING ERRCODE='23514'; END IF;
  UPDATE public.workspaces SET name=COALESCE(btrim(new_name),name),tier=COALESCE(new_tier,tier) WHERE id=ws;
  IF new_owner IS NOT NULL AND new_owner<>old_owner THEN
    PERFORM public.platform_transfer_workspace_owner(ws,new_owner,'member');
  END IF;
  INSERT INTO platform_private.admin_audit(actor_id,workspace_id,action)
    VALUES(auth.uid(),ws,'workspace.update');
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_assign_workspace_member(uuid,uuid,public.workspace_role,text),
  public.platform_update_workspace(uuid,text,smallint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_assign_workspace_member(uuid,uuid,public.workspace_role,text),
  public.platform_update_workspace(uuid,text,smallint,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_set_workspace_member(uuid,uuid,public.workspace_role),
  public.platform_set_global_role(uuid,public.app_role,boolean),
  public.platform_remove_workspace_member(uuid,uuid),
  public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role),
  public.platform_set_member_profile(uuid,uuid,text),
  public.platform_create_workspace(text,text,uuid,smallint),
  public.platform_create_workspace_invite(uuid,text,interval), public.platform_revoke_workspace_invite(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_set_workspace_member(uuid,uuid,public.workspace_role),
  public.platform_set_global_role(uuid,public.app_role,boolean),
  public.platform_remove_workspace_member(uuid,uuid),
  public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role),
  public.platform_set_member_profile(uuid,uuid,text),
  public.platform_create_workspace(text,text,uuid,smallint),
  public.platform_create_workspace_invite(uuid,text,interval), public.platform_revoke_workspace_invite(uuid)
  TO authenticated;

COMMIT;
