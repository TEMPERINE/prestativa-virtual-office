-- Real writes against synthetic fixtures in a disposable database only.
SELECT public._test_rejected($$INSERT INTO public.workspace_invites(workspace_id,email,role,invited_by) VALUES('10000000-0000-4000-8000-000000000001',NULL,'owner','00000000-0000-4000-8000-000000000002')$$,'23514','privileged invite is rejected independently of RLS and trusted grants');
SELECT public._test_rejected($$UPDATE public.workspace_members SET role='owner' WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000004'$$,'23514','trusted writes cannot create a noncanonical second owner');
SELECT public._test_rejected($$DELETE FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000002'$$,'23514','trusted writes cannot remove canonical owner without transfer');
BEGIN;
DELETE FROM public.workspaces WHERE id='10000000-0000-4000-8000-000000000001';
SELECT public._test_assert(NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001'),'legitimate parent workspace deletion still cascades memberships');
ROLLBACK;
