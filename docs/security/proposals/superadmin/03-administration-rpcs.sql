-- PROPOSAL ONLY. New RPCs; local management remains disabled until stage 04.
BEGIN;
CREATE FUNCTION public.platform_set_global_role(target uuid,new_role public.app_role,enabled boolean)
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
CREATE FUNCTION platform_private.require_membership_manager(ws uuid, target uuid, new_role public.workspace_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing_role public.workspace_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account inactive' USING ERRCODE='42501'; END IF;
  IF public.platform_is_superadmin() THEN RETURN; END IF;
  IF NOT (SELECT membership_hardened FROM platform_private.transition WHERE singleton)
     OR NOT public.is_workspace_admin(ws,auth.uid()) THEN
    RAISE EXCEPTION 'workspace administration denied' USING ERRCODE='42501';
  END IF;
  SELECT role INTO existing_role FROM public.workspace_members WHERE workspace_id=ws AND user_id=target;
  IF new_role IS DISTINCT FROM 'member'::public.workspace_role
     OR existing_role IN ('owner','admin')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=target AND role='superadmin') THEN
    RAISE EXCEPTION 'privileged member is protected' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION platform_private.check_capacity(ws uuid, target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE limit_count integer; actual_count integer;
BEGIN
  SELECT CASE tier WHEN 1 THEN 2 WHEN 2 THEN 5 ELSE 2147483647 END
    INTO limit_count FROM public.workspaces WHERE id=ws;
  SELECT count(*) INTO actual_count FROM public.workspace_members WHERE workspace_id=ws;
  IF actual_count>=limit_count AND NOT public.is_workspace_member(ws,target) THEN
    RAISE EXCEPTION 'workspace member limit reached' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION public.platform_set_workspace_member(ws uuid,target uuid,new_role public.workspace_role)
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

CREATE FUNCTION public.platform_remove_workspace_member(ws uuid,target uuid)
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

CREATE FUNCTION public.platform_transfer_workspace_owner(ws uuid,new_owner uuid,former_role public.workspace_role DEFAULT 'member')
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

CREATE FUNCTION public.platform_set_member_profile(ws uuid,target uuid,new_profile text)
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

CREATE FUNCTION public.platform_create_workspace(ws_slug text,ws_name text,owner uuid,ws_tier smallint DEFAULT 1)
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

CREATE FUNCTION public.platform_create_workspace_invite(ws uuid,invite_email text DEFAULT NULL,valid_for interval DEFAULT interval '30 days')
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

CREATE FUNCTION public.platform_revoke_workspace_invite(invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws uuid;
BEGIN
  SELECT workspace_id INTO ws FROM public.workspace_invites WHERE id=invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR UPDATE;
  PERFORM platform_private.require_membership_manager(ws,NULL,'member');
  DELETE FROM public.workspace_invites WHERE id=invite_id AND workspace_id=ws;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;
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
