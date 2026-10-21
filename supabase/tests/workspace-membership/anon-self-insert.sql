-- Obrigatório: anônimo autenticado NÃO se insere em workspace_members.
-- Roda em transação e força ROLLBACK no final (nenhum dado permanece).
BEGIN;
DO $$
DECLARE ws uuid; anon uuid := gen_random_uuid(); member uuid;
BEGIN
  SELECT id INTO ws FROM public.workspaces LIMIT 1;
  SELECT user_id INTO member FROM public.workspace_members WHERE workspace_id=ws AND role='member' LIMIT 1;

  -- Ator 3: anônimo sem visitor
  PERFORM set_config('request.jwt.claims', json_build_object('sub',anon,'role','authenticated','is_anonymous',true)::text, true);
  PERFORM set_config('request.jwt.claim.sub', anon::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES (ws,anon,'member');
    RAISE EXCEPTION 'FAIL: anon inserted member';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES (ws,anon,'owner');
    RAISE EXCEPTION 'FAIL: anon inserted owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.account_groups) THEN RAISE EXCEPTION 'FAIL: anon reads groups'; END IF;
  BEGIN
    INSERT INTO public.profiles(id,display_name) VALUES (anon,'x');
    RAISE EXCEPTION 'FAIL: anon created profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- Membro comum: não se promove nem insere outro usuário
  IF member IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',member,'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', member::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.workspace_members SET role='admin' WHERE workspace_id=ws AND user_id=member;
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=member AND role<>'member') THEN
      RAISE EXCEPTION 'FAIL: member self-promoted';
    END IF;
    BEGIN
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES (ws,anon,'member');
      RAISE EXCEPTION 'FAIL: member inserted other user';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END IF;
  RAISE NOTICE 'PASS';
END $$;
ROLLBACK;
