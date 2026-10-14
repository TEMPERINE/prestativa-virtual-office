-- Synthetic identities and data only. Executed in disposable PostgreSQL.
BEGIN;
CREATE FUNCTION public._test_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

CREATE FUNCTION public._test_denied(statement text, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
    -- Roll back an unexpectedly successful write before reporting failure.
    RAISE EXCEPTION SQLSTATE 'PT001';
  EXCEPTION
    WHEN insufficient_privilege THEN rejected := true;
    WHEN SQLSTATE 'PT001' THEN rejected := false;
  END;
  PERFORM public._test_assert(rejected, label);
END $$;

CREATE FUNCTION public._test_invalid_invite(token text, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.workspace_accept_invite(token);
    RAISE EXCEPTION SQLSTATE 'PT001';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT IN ('invite invalid or expired', 'invite already used',
                        'invite is not for this account') THEN RAISE; END IF;
      rejected := true;
    WHEN SQLSTATE 'PT001' THEN rejected := false;
  END;
  PERFORM public._test_assert(rejected, label);
END $$;

INSERT INTO auth.users VALUES
 ('00000000-0000-4000-8000-000000000001', 'owner@example.test'),
 ('00000000-0000-4000-8000-000000000002', 'member@example.test'),
 ('00000000-0000-4000-8000-000000000003', 'admin@example.test'),
 ('00000000-0000-4000-8000-000000000004', 'invited@example.test');
INSERT INTO public.profiles(id, display_name, plan)
SELECT id, email, 'premium' FROM auth.users;
INSERT INTO public.user_roles(user_id, role) VALUES
 ('00000000-0000-4000-8000-000000000001', 'admin'),
 ('00000000-0000-4000-8000-000000000003', 'admin');
INSERT INTO public.workspaces(id,slug,name,owner_id,tier) VALUES
 ('10000000-0000-4000-8000-000000000001','owned','Owned',
  '00000000-0000-4000-8000-000000000001',3),
 ('10000000-0000-4000-8000-000000000002','peer','Peer',
  '00000000-0000-4000-8000-000000000001',3);
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','admin'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','member');
INSERT INTO public.workspace_invites(workspace_id,email,token,invited_by,expires_at) VALUES
 ('10000000-0000-4000-8000-000000000001','invited@example.test','valid',
  '00000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('10000000-0000-4000-8000-000000000001','invited@example.test','expired',
  '00000000-0000-4000-8000-000000000001',now()-interval '1 day'),
 ('10000000-0000-4000-8000-000000000001','invited@example.test','revoked',
  '00000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('10000000-0000-4000-8000-000000000001','owner@example.test','wrong-account',
  '00000000-0000-4000-8000-000000000001',now()+interval '1 day');
-- Current revocation model: delete the invitation, not a fictional revoked flag.
DELETE FROM public.workspace_invites WHERE token='revoked';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
SELECT public._test_denied(
 $$INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member')$$,
 'nonmember cannot self-join another workspace');
SELECT public._test_denied(
 $$INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','owner')$$,
 'nonmember cannot self-join as owner');
SELECT public._test_denied(
 $$INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','owner')
 ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='owner'$$,
 'member cannot self-promote through upsert');
UPDATE public.workspace_members SET role='owner'
WHERE workspace_id='10000000-0000-4000-8000-000000000002'
AND user_id='00000000-0000-4000-8000-000000000002';
SELECT public._test_assert(
 (SELECT role='member' FROM public.workspace_members
  WHERE workspace_id='10000000-0000-4000-8000-000000000002'
  AND user_id=auth.uid()), 'member cannot self-promote through update');
SELECT public._test_assert(
 NOT public.is_workspace_admin('10000000-0000-4000-8000-000000000002',auth.uid()),
 'admin helper returns false for member without RLS recursion');
SELECT public._test_denied(
 $$INSERT INTO public.workspaces(slug,name,owner_id)
 VALUES ('nonadmin','Denied','00000000-0000-4000-8000-000000000002')$$,
 'existing global-admin requirement for workspace creation is preserved');

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
SELECT public._test_denied(
 $$INSERT INTO public.workspaces(slug,name,owner_id)
 VALUES ('spoof-owner','Denied','00000000-0000-4000-8000-000000000002')$$,
 'even global admin cannot assign someone else as owner through client insert');
SELECT public._test_denied(
 $$INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','owner')$$,
 'workspace admin cannot bypass server-side member insertion');
SELECT public._test_assert(
 public.is_workspace_admin('10000000-0000-4000-8000-000000000001',auth.uid()),
 'admin helper returns true for admin without RLS recursion');

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
INSERT INTO public.workspaces(id,slug,name,owner_id,tier)
VALUES ('10000000-0000-4000-8000-000000000003','new-own','Own',auth.uid(),3);
INSERT INTO public.workspace_members(workspace_id,user_id,role)
VALUES ('10000000-0000-4000-8000-000000000003',auth.uid(),'owner');
SELECT public._test_assert(
 (SELECT role='owner' FROM public.workspace_members
  WHERE workspace_id='10000000-0000-4000-8000-000000000003' AND user_id=auth.uid()),
 'legitimate client workspace creation and owner membership succeed');
SELECT public._test_denied(
 $$INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','member')$$,
 'even actual owner cannot insert another person through client');

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
SELECT public._test_invalid_invite('unknown','unknown invite rejected');
SELECT public._test_invalid_invite('expired','expired invite rejected');
SELECT public._test_invalid_invite('revoked','revoked invite rejected');
SELECT public._test_invalid_invite('wrong-account','email-locked invite rejects wrong account');
SELECT public._test_assert(
 public.workspace_accept_invite('valid')='10000000-0000-4000-8000-000000000001',
 'valid invitation RPC succeeds under authenticated role after RLS change');
SELECT public._test_assert(
 (SELECT role='member' FROM public.workspace_members
  WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id=auth.uid()),
 'invitation RPC persisted the authenticated member');
SELECT public._test_invalid_invite('valid','consumed single-use invite rejected');

RESET ROLE;
SELECT public._test_assert(
 (SELECT prosecdef AND pg_get_userbyid(proowner)='postgres'
  FROM pg_proc WHERE oid='public.workspace_accept_invite(text)'::regprocedure),
 'actual invitation function is SECURITY DEFINER owned by postgres in isolated DB');
SET LOCAL ROLE service_role;
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','member')
 ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role;
SELECT public._test_assert(
 (SELECT role='member' FROM public.workspace_members
  WHERE workspace_id='10000000-0000-4000-8000-000000000002'
  AND user_id='00000000-0000-4000-8000-000000000004'),
 'server-side service_role administrative upsert succeeds');
INSERT INTO public.workspaces(slug,name,owner_id,tier)
VALUES ('admin-assigned','Server assigned','00000000-0000-4000-8000-000000000002',3);
SELECT public._test_assert(
 EXISTS(SELECT 1 FROM public.workspaces WHERE slug='admin-assigned'
 AND owner_id='00000000-0000-4000-8000-000000000002'),
 'server-side administration can assign a workspace to another owner');
ROLLBACK;
