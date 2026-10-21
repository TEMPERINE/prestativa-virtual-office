-- Rollback-only connected PostgreSQL authorization/RPC test, not Auth/UI/RTC.
-- Synthetic anonymous claim subjects have no auth.users rows; consequently
-- actual visitor position writes and browser onboarding require a real session.
BEGIN;
DO $$
DECLARE
  owner_uid uuid; ws uuid:=gen_random_uuid(); visitor_uid uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid(); invite jsonb; invite_id uuid; result_ws uuid;
  denied boolean; topic text; member_profiles_visible boolean;
BEGIN
  SELECT r.user_id INTO owner_uid FROM public.user_roles r JOIN auth.users u ON u.id=r.user_id
    WHERE r.role='admin' AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) LIMIT 1;
  IF owner_uid IS NULL THEN RAISE EXCEPTION 'BLOCKER: authorized workspace creator required'; END IF;
  PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated','is_anonymous',false)::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.workspaces(id,slug,name,owner_id,tier) VALUES(ws,'visitor-test-'||ws::text,'Rollback visitor test',auth.uid(),1);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,auth.uid(),'owner');
  INSERT INTO public.positions(workspace_id,user_id,x,y,zone,facing,is_online) VALUES(ws,auth.uid(),100,100,'lobby','down',true);
  invite:=public.visitor_create_invite(ws,'Temporary test',now(),now()+interval '1 hour');
  invite_id:=(invite->>'id')::uuid;
  PERFORM set_config('request.jwt.claim.sub',visitor_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',visitor_uid,'role','authenticated','is_anonymous',true)::text,true);
  result_ws:=public.visitor_activate(invite->>'token','Temporary test','marcio');
  IF result_ws<>ws OR public.is_workspace_member(ws,auth.uid())
    OR NOT public.can_access_workspace_runtime(ws,auth.uid())
    OR public.is_workspace_admin(ws,auth.uid()) THEN RAISE EXCEPTION 'FAIL: visitor runtime isolation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws)
    OR NOT EXISTS(SELECT 1 FROM public.positions WHERE workspace_id=ws AND user_id=owner_uid) THEN
    RAISE EXCEPTION 'FAIL: visitor cannot read member runtime'; END IF;
  member_profiles_visible:=EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_uid);
  PERFORM public.claim_office_session(gen_random_uuid(),ws);
  FOREACH topic IN ARRAY ARRAY['presence','movement','map'] LOOP
    IF NOT public.rtc_can_access_topic('workspace:'||ws::text||':'||topic) THEN RAISE EXCEPTION 'FAIL: visitor runtime topic'; END IF;
  END LOOP;
  IF public.rtc_can_access_topic('workspace:'||ws::text||':meeting-idle') THEN RAISE EXCEPTION 'FAIL: visitor meeting topic'; END IF;
  denied:=false;
  BEGIN
    INSERT INTO public.workspace_claims(workspace_id,zone_id,user_id) VALUES(ws,'test-desk',auth.uid());
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: visitor created claim'; END IF;
  denied:=false;
  BEGIN INSERT INTO public.prop_states(workspace_id,prop_id,frame,updated_by) VALUES(ws,'test-prop',1,auth.uid());
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: visitor modified prop'; END IF;
  denied:=false;
  BEGIN PERFORM public.chat_start_conversation(ws,owner_uid);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: visitor Chat'; END IF;
  denied:=false;
  BEGIN PERFORM public.meeting_join(ws,'reuniao','Test');
  EXCEPTION
    WHEN insufficient_privilege THEN denied:=true;
    WHEN raise_exception THEN
      IF SQLERRM<>'not a workspace member' THEN RAISE; END IF;
      denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: visitor Meeting'; END IF;
  PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.workspace_visitors WHERE workspace_id=ws AND user_id=visitor_uid)
    OR NOT public.can_access_workspace_runtime(ws,auth.uid()) THEN RAISE EXCEPTION 'FAIL: member sees visitor'; END IF;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.workspace_members WHERE user_id=visitor_uid)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id=visitor_uid) THEN RAISE EXCEPTION 'FAIL: visitor became profile/member'; END IF;
  UPDATE public.workspace_visitors SET expires_at=now()-interval '1 second' WHERE workspace_id=ws AND user_id=visitor_uid;
  IF public.can_access_workspace_runtime(ws,visitor_uid) THEN RAISE EXCEPTION 'FAIL: expired visitor access'; END IF;
  UPDATE public.workspace_visitors SET expires_at=now()+interval '1 hour' WHERE workspace_id=ws AND user_id=visitor_uid;
  SET LOCAL ROLE authenticated;
  PERFORM public.visitor_revoke((invite->>'id')::uuid);
  IF public.can_access_workspace_runtime(ws,visitor_uid) THEN RAISE EXCEPTION 'FAIL: revoked visitor access'; END IF;
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','is_anonymous',true)::text,true);
  IF public.can_access_workspace_runtime(ws,auth.uid()) OR public.is_workspace_member(ws,auth.uid())
    OR EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws)
    OR EXISTS(SELECT 1 FROM public.account_groups)
    OR EXISTS(SELECT 1 FROM public.positions WHERE workspace_id=ws) THEN RAISE EXCEPTION 'FAIL: outsider runtime/groups'; END IF;
  denied:=false;
  BEGIN INSERT INTO public.profiles(id,display_name) VALUES(auth.uid(),'Denied');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: anonymous profile'; END IF;
  denied:=false;
  BEGIN INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,auth.uid(),'owner');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: anonymous owner'; END IF;
  denied:=false;
  BEGIN INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,auth.uid(),'member');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: anonymous member'; END IF;
  denied:=false;
  BEGIN PERFORM public.claim_office_session(gen_random_uuid(),ws);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: anonymous office session'; END IF;
  RESET ROLE;
  IF NOT member_profiles_visible THEN RAISE EXCEPTION 'FAIL: visitor cannot read member profiles (membership subquery is RLS-filtered)'; END IF;
  RAISE NOTICE 'PASS: visitor activation/runtime authorization/revoke/expire; anonymous isolation';
END $$;
SELECT 'PASS: visitor database authorization (not Auth/UI/position/RTC)' AS result;
ROLLBACK;