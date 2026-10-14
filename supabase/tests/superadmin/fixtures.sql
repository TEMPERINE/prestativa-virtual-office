-- Synthetic fixture identifiers ONLY, never deployed.
CREATE FUNCTION public._test_assert(ok boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION public._test_rejected(statement text,expected_state text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION SQLSTATE 'PT001';
  EXCEPTION WHEN OTHERS THEN actual_state:=SQLSTATE;
  END;
  PERFORM public._test_assert(actual_state=expected_state,label);
END $$;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000001','privileged@example.test'),
 ('00000000-0000-4000-8000-000000000002','owner@example.test'),
 ('00000000-0000-4000-8000-000000000003','local-admin@example.test'),
 ('00000000-0000-4000-8000-000000000004','member@example.test'),
 ('00000000-0000-4000-8000-000000000005','invitee@example.test'),
 ('00000000-0000-4000-8000-000000000006','legacy@example.test'),
 ('00000000-0000-4000-8000-000000000007','recovery@example.test');
INSERT INTO public.profiles(id,display_name,plan) SELECT id,'Fixture','premium' FROM auth.users;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001','admin'),
 ('00000000-0000-4000-8000-000000000001','master');
INSERT INTO public.workspaces(id,slug,name,owner_id,tier) VALUES
 ('10000000-0000-4000-8000-000000000001','fixture-one','Fixture', '00000000-0000-4000-8000-000000000002',3),
 ('10000000-0000-4000-8000-000000000002','fixture-two','Fixture', '00000000-0000-4000-8000-000000000006',3);
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','owner'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','admin'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','member'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000006','owner');
