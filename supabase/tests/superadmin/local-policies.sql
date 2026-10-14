-- Positive RLS checks as actual authenticated roles, not trusted SQL owners.
BEGIN;
INSERT INTO public.sprite_skins(id,label,workspace_id,sheets,dims)
VALUES ('local-policy-fixture','Fixture','10000000-0000-4000-8000-000000000001','{}','{}');
INSERT INTO public.rtc_events(user_id,workspace_id,event_type)
VALUES ('00000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','fixture');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
INSERT INTO public.map_overrides(workspace_id,data)
VALUES ('10000000-0000-4000-8000-000000000001','{}');
UPDATE public.map_overrides SET data='{"fixture":true}'
WHERE workspace_id='10000000-0000-4000-8000-000000000001';
SELECT public._test_assert((SELECT data='{"fixture":true}'::jsonb FROM public.map_overrides WHERE workspace_id='10000000-0000-4000-8000-000000000001'),'local owner can insert and update workspace map after retirement');
DELETE FROM public.map_overrides WHERE workspace_id='10000000-0000-4000-8000-000000000001';
SELECT public._test_assert(NOT EXISTS(SELECT 1 FROM public.map_overrides WHERE workspace_id='10000000-0000-4000-8000-000000000001'),'local owner can delete workspace map');
INSERT INTO public.custom_props(id,workspace_id,label)
VALUES ('local-policy-fixture','10000000-0000-4000-8000-000000000001','Fixture');
UPDATE public.custom_props SET label='Updated' WHERE id='local-policy-fixture';
SELECT public._test_assert((SELECT label='Updated' FROM public.custom_props WHERE id='local-policy-fixture'),'local owner can insert and update custom props');
DELETE FROM public.custom_props WHERE id='local-policy-fixture';
SELECT public._test_assert(NOT EXISTS(SELECT 1 FROM public.custom_props WHERE id='local-policy-fixture'),'local owner can delete custom props');
INSERT INTO public.map_save_points(workspace_id,name,data,created_by)
VALUES ('10000000-0000-4000-8000-000000000001','Fixture','{}',auth.uid());
SELECT public._test_assert((SELECT count(*)=1 FROM public.map_save_points WHERE name='Fixture'),'local owner can create and read save points');
DELETE FROM public.map_save_points WHERE name='Fixture';
SELECT public._test_assert(NOT EXISTS(SELECT 1 FROM public.map_save_points WHERE name='Fixture'),'local owner can delete save points');
SELECT public._test_assert((SELECT count(*)=1 FROM public.rtc_events WHERE event_type='fixture'),'local owner can read workspace telemetry without a global role');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
SELECT public._test_assert((SELECT count(*)=1 FROM public.sprite_skins WHERE id='local-policy-fixture'),'ordinary member can read its workspace sprite catalog');
SELECT public._test_rejected($$INSERT INTO public.map_overrides(workspace_id,data) VALUES('10000000-0000-4000-8000-000000000001','{}')$$,'42501','ordinary member cannot edit the map while helpers remain callable');
ROLLBACK;
