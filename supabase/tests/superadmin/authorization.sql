-- Authorization SQL is executed only in disposable PostgreSQL with fake data.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
SELECT public._test_rejected($$INSERT INTO public.workspace_members(workspace_id,user_id,role)
 VALUES('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','member')$$,'42501','nonmember cannot self-join foreign workspace');
SELECT public._test_rejected($$UPDATE public.workspace_members SET role='admin'
 WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id=auth.uid()$$,'42501','member cannot self-promote');
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001',auth.uid(),'admin')$$,'42501','RPC does not allow member self-promotion');
SELECT public._test_rejected($$SELECT public.platform_set_global_role(auth.uid(),'admin',true)$$,'42501','member cannot assign global roles');
SELECT public._test_rejected($$SELECT public.platform_transfer_workspace_owner('10000000-0000-4000-8000-000000000001',auth.uid(),'member')$$,'42501','member cannot transfer ownership');
SELECT public._test_rejected($$SELECT * FROM platform_private.admin_audit$$,'42501','private audit cannot be read from client');
SELECT public._test_rejected($$SELECT public.platform_is_superadmin('00000000-0000-4000-8000-000000000001')$$,'42883','public superadmin check accepts no actor override');
SELECT set_config('prestativa.superadmin_maintenance','on',false);
SELECT public._test_rejected($$INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'superadmin')$$,'42501','client cannot forge maintenance authority');
SELECT set_config('prestativa.superadmin_maintenance','off',false);

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='00000000-0000-4000-8000-000000000003';
SET ROLE authenticated;
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','member')$$,'42501','inactive local administrator cannot use stale authenticated identity');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='00000000-0000-4000-8000-000000000003';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='00000000-0000-4000-8000-000000000005';
SET ROLE authenticated;
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','member')$$,'23514','inactive target cannot gain membership through administrative RPC');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='00000000-0000-4000-8000-000000000005';
SET ROLE authenticated;
SELECT public._test_rejected($$INSERT INTO public.workspace_members(workspace_id,user_id,role)
 VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','member')$$,'42501','local admin direct membership write denied');
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','member')$$,'42501','local admin cannot administer foreign workspace');
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','admin')$$,'42501','local admin cannot promote to admin');
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member')$$,'42501','local admin cannot demote owner');
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','member')$$,'42501','local admin cannot change superadmin membership');
SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','member');
SELECT public._test_assert(public.is_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005'),'local admin adds ordinary member via validated RPC');
SELECT public.platform_set_member_profile('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','strategic');
SELECT public._test_assert((SELECT member_profile='strategic' FROM public.workspace_members
 WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000005'),'local ordinary profile administration preserved');
SELECT public.platform_remove_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005');
SELECT public._test_assert(NOT public.is_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005'),'local admin removes ordinary member via RPC');
DELETE FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001'
 AND user_id='00000000-0000-4000-8000-000000000004';
SELECT public._test_assert(public.is_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004'),'client direct removal of another member changes no rows');
SELECT public._test_rejected($$INSERT INTO public.workspace_invites(workspace_id,email,role,invited_by)
 VALUES('10000000-0000-4000-8000-000000000001',NULL,'admin',auth.uid())$$,'42501','direct privileged invitation denied');
SELECT public._test_assert(public.platform_create_workspace_invite('10000000-0000-4000-8000-000000000001') IS NOT NULL,'local invite creation remains through RPC');

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','member')$$,'42501','owner cannot demote admin');
SELECT public._test_rejected($$UPDATE public.workspaces SET owner_id='00000000-0000-4000-8000-000000000004'
 WHERE id='10000000-0000-4000-8000-000000000001'$$,'42501','owner cannot bypass transfer through direct update');
DELETE FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id=auth.uid();
SELECT public._test_assert(public.is_workspace_member('10000000-0000-4000-8000-000000000001',auth.uid()),'canonical owner cannot orphan workspace by leaving');

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000006';
SELECT public._test_assert(NOT public.platform_is_superadmin(),'legacy admin/master still not superadmin after cutover');
SELECT public._test_rejected($$SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','admin')$$,'42501','legacy global admin/master has no platform override');
SELECT public._test_rejected($$INSERT INTO public.workspaces(slug,name,owner_id,tier)
 VALUES('forged','Forged','00000000-0000-4000-8000-000000000004',3)$$,'42501','workspace cannot be created with another owner_id');
INSERT INTO public.workspaces(id,slug,name,owner_id,tier)
 VALUES('10000000-0000-4000-8000-000000000003','legitimate','Legitimate',auth.uid(),3);
INSERT INTO public.workspace_members(workspace_id,user_id,role)
 VALUES('10000000-0000-4000-8000-000000000003',auth.uid(),'owner');
SELECT public._test_assert(public.is_workspace_admin('10000000-0000-4000-8000-000000000003',auth.uid()),'bounded eligible self-creation plus owner membership works');
SELECT public._test_rejected($$INSERT INTO public.map_overrides(workspace_id,data)
 VALUES('10000000-0000-4000-8000-000000000001','{}')$$,'42501','legacy global admin has no cross-workspace map override');
SELECT public._test_rejected($$INSERT INTO storage.objects(bucket_id,name) VALUES('sprite-sheets','fixture')$$,'42501','legacy global admin cannot write sprite bucket directly');

RESET ROLE;
INSERT INTO public.workspace_invites(workspace_id,email,token,role,invited_by,expires_at) VALUES
 ('10000000-0000-4000-8000-000000000001','invitee@example.test','valid','member','00000000-0000-4000-8000-000000000002',now()+interval '1 day'),
 ('10000000-0000-4000-8000-000000000001',NULL,'expired','member','00000000-0000-4000-8000-000000000002',now()-interval '1 day'),
 ('10000000-0000-4000-8000-000000000001','owner@example.test','wrong-account','member','00000000-0000-4000-8000-000000000002',now()+interval '1 day'),
 ('10000000-0000-4000-8000-000000000001',NULL,'revoked','member','00000000-0000-4000-8000-000000000002',now()+interval '1 day');
DELETE FROM public.workspace_invites WHERE token='revoked';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workspace_invites_member_only') THEN
    PERFORM public._test_rejected($test$INSERT INTO public.workspace_invites(workspace_id,email,role,invited_by) VALUES('10000000-0000-4000-8000-000000000001',NULL,'owner','00000000-0000-4000-8000-000000000002')$test$,'23514','DB CHECK prevents privileged invitation even from trusted SQL');
    -- Model a corrupt historical row, never a production maintenance action.
    ALTER TABLE public.workspace_invites DROP CONSTRAINT workspace_invites_member_only;
    INSERT INTO public.workspace_invites(workspace_id,email,token,role,invited_by) VALUES('10000000-0000-4000-8000-000000000001',NULL,'privileged','admin','00000000-0000-4000-8000-000000000002');
    ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_member_only CHECK(role='member') NOT VALID;
  ELSE
    INSERT INTO public.workspace_invites(workspace_id,email,token,role,invited_by) VALUES('10000000-0000-4000-8000-000000000001',NULL,'privileged','admin','00000000-0000-4000-8000-000000000002');
  END IF;
END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
SELECT public._test_rejected($$SELECT public.workspace_accept_invite('missing')$$,'P0001','invalid invite fails');
SELECT public._test_rejected($$SELECT public.workspace_accept_invite('expired')$$,'P0001','expired invite fails');
SELECT public._test_rejected($$SELECT public.workspace_accept_invite('revoked')$$,'P0001','revoked invite fails');
SELECT public._test_rejected($$SELECT public.workspace_accept_invite('wrong-account')$$,'P0001','email-locked invite for another account fails');
SELECT public._test_rejected($$SELECT public.workspace_accept_invite('privileged')$$,'42501','historical privileged invite cannot bypass promotion RPC');
SELECT public._test_assert(public.workspace_accept_invite('valid')='10000000-0000-4000-8000-000000000001','valid invitation still works under restricted RLS');
SELECT public._test_rejected($$SELECT public.workspace_accept_invite('valid')$$,'P0001','single-use invite cannot be consumed twice');

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public._test_assert(NOT public.is_workspace_member('10000000-0000-4000-8000-000000000001',auth.uid()),'superadmin has no membership in target fixture');
SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','admin');
SELECT public._test_assert((SELECT role='admin' FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000005') IS NULL,'global read is not added to client membership RLS');
RESET ROLE;
SELECT public._test_assert((SELECT role='admin' FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000005'),'superadmin promotes admin without membership');
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public.platform_set_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','member');
SELECT public.platform_remove_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005');
SELECT public._test_rejected($$SELECT public.platform_remove_workspace_member('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')$$,'23514','even superadmin uses explicit transfer before canonical owner removal');
SELECT public.platform_transfer_workspace_owner('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','member');
RESET ROLE;
SELECT public._test_assert((SELECT owner_id='00000000-0000-4000-8000-000000000003' FROM public.workspaces WHERE id='10000000-0000-4000-8000-000000000001')
 AND (SELECT role='owner' FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000003')
 AND (SELECT role='member' FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000002'),'owner transfer synchronizes canonical owner and memberships');
UPDATE public.profiles SET plan='essencial' WHERE id='00000000-0000-4000-8000-000000000004';
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public._test_rejected($$SELECT public.platform_transfer_workspace_owner('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','member')$$,'23514','plan mismatch rejects transfer atomically');
RESET ROLE;
SELECT public._test_assert((SELECT owner_id='00000000-0000-4000-8000-000000000003' FROM public.workspaces WHERE id='10000000-0000-4000-8000-000000000001'),'failed transfer leaves previous owner intact');

-- The historical signup flow was removed; rollout must not recreate it.
SELECT public._test_assert(to_regclass('public.signup_invites') IS NULL
 AND to_regprocedure('public.signup_invite_redeem(text,text)') IS NULL,'obsolete signup schema remains absent');
SET ROLE service_role;
SELECT public._test_assert((public.platform_recover_superadmin('00000000-0000-4000-8000-000000000007')->>'recovered')::boolean,'service recovery remains available after retirement');
RESET ROLE;
SELECT public._test_assert((SELECT count(*)=1 FROM public.user_roles WHERE user_id='00000000-0000-4000-8000-000000000007'),'postcut recovery grants only superadmin not legacy labels');
SELECT public._test_assert((SELECT count(*)=1 FROM public.user_roles WHERE role='superadmin'),'postcut recovery still preserves singleton');
SELECT public._test_assert((SELECT count(*)>0 FROM platform_private.admin_audit WHERE action='workspace.owner_transfer'),'privileged writes produce private audit events');
SELECT public._test_assert(NOT has_function_privilege('anon','public.platform_is_superadmin()','EXECUTE'),'anonymous cannot access new guard');
SELECT public._test_assert(NOT has_function_privilege('authenticated','public.platform_recover_superadmin(uuid)','EXECUTE'),'client recovery permission remains denied');
