-- Connected-database regression. Existing users are used only as claim subjects;
-- all workspace/member/invite fixtures live in this transaction and roll back.
-- This exercises PostgreSQL RLS/RPC, NOT Supabase Auth or the browser UI.
BEGIN;
DO $$
DECLARE
  owner_uid uuid; admin_uid uuid; member_uid uuid; ws uuid := gen_random_uuid();
  removed integer; accepted uuid; token text := gen_random_uuid()::text;
BEGIN
  SELECT r.user_id INTO owner_uid FROM public.user_roles r
  JOIN auth.users u ON u.id=r.user_id
  WHERE r.role='admin' AND NOT coalesce(u.is_anonymous,false) AND u.deleted_at IS NULL LIMIT 1;
  SELECT id INTO admin_uid FROM auth.users WHERE id<>owner_uid
    AND NOT coalesce(is_anonymous,false) AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO member_uid FROM auth.users WHERE id NOT IN (owner_uid,admin_uid)
    AND NOT coalesce(is_anonymous,false) AND deleted_at IS NULL LIMIT 1;
  IF owner_uid IS NULL OR admin_uid IS NULL OR member_uid IS NULL THEN
    RAISE EXCEPTION 'BLOCKER: three valid existing accounts required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated','is_anonymous',false)::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.workspaces(id,slug,name,owner_id,tier)
    VALUES(ws,'hardening-test-'||ws::text,'Rollback-only hardening test',auth.uid(),1);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,auth.uid(),'owner');
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws AND owner_id=auth.uid())
    OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid() AND role='owner') THEN
    RAISE EXCEPTION 'FAIL: authorized workspace creation/owner identity';
  END IF;
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,admin_uid,'admin'),(ws,member_uid,'member');
  -- Each actor attempts owner deletion. Zero affected rows is RLS denial.
  FOREACH accepted IN ARRAY ARRAY[admin_uid,member_uid,owner_uid] LOOP
    PERFORM set_config('request.jwt.claim.sub',accepted::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',accepted,'role','authenticated')::text,true);
    DELETE FROM public.workspace_members WHERE workspace_id=ws AND user_id=owner_uid;
    GET DIAGNOSTICS removed=ROW_COUNT;
    IF removed<>0 THEN RAISE EXCEPTION 'FAIL: actor removed owner'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=owner_uid AND role='owner') THEN
      RAISE EXCEPTION 'FAIL: owner missing after actor deletion';
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',admin_uid::text,true);
  DELETE FROM public.workspace_members WHERE workspace_id=ws AND user_id=member_uid;
  GET DIAGNOSTICS removed=ROW_COUNT;
  IF removed<>1 THEN RAISE EXCEPTION 'FAIL: admin cannot remove ordinary member'; END IF;
  PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,member_uid,'member');
  DELETE FROM public.workspace_members WHERE workspace_id=ws AND user_id IN (member_uid,admin_uid);
  GET DIAGNOSTICS removed=ROW_COUNT;
  IF removed<>2 THEN RAISE EXCEPTION 'FAIL: owner cannot remove member/admin'; END IF;
  -- Generate the existing normal member invitation under owner's RLS.
  INSERT INTO public.workspace_invites(workspace_id,role,token,invited_by,expires_at,max_uses)
    VALUES(ws,'member',token,auth.uid(),now()+interval '1 hour',1);
  PERFORM set_config('request.jwt.claim.sub',member_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated','is_anonymous',false)::text,true);
  accepted:=public.workspace_accept_invite(token);
  IF accepted<>ws OR NOT EXISTS(SELECT 1 FROM public.workspace_members
    WHERE workspace_id=ws AND user_id=auth.uid() AND role='member') THEN
    RAISE EXCEPTION 'FAIL: normal invitation acceptance/member identity';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws)
    OR NOT public.can_access_workspace_runtime(ws,auth.uid()) THEN
    RAISE EXCEPTION 'FAIL: invited member cannot access workspace';
  END IF;
  UPDATE public.workspace_members SET role='admin' WHERE workspace_id=ws AND user_id=auth.uid();
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=ws AND user_id=auth.uid();
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid() AND role='member') THEN
    RAISE EXCEPTION 'FAIL: invited member selected privileged role';
  END IF;
  RESET ROLE;
  -- Trigger protects bypass-RLS writes too; use a subtransaction for denial.
  BEGIN
    DELETE FROM public.workspace_members WHERE workspace_id=ws AND user_id=owner_uid;
    RAISE EXCEPTION 'FAIL: privileged deletion removed canonical owner';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Preserve existing explicit workspace deletion/cascade.
  PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.workspaces WHERE id=ws;
  GET DIAGNOSTICS removed=ROW_COUNT;
  IF removed<>1 OR EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws) THEN
    RAISE EXCEPTION 'FAIL: explicit workspace deletion/cascade';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS: owner DELETE, authorized creation, normal invite, member access, no self-promotion, workspace cascade';
END $$;
ROLLBACK;