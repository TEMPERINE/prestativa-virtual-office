-- Prepared for review only. Do not apply to production before catalog preflight
-- and approval. No existing rows, RPCs, roles or non-INSERT policies are changed.
BEGIN;

-- SECURITY DEFINER alone does not guarantee bypass of RLS. Refuse deployment
-- when the actual function owners cannot bypass membership RLS, or when another
-- permissive INSERT/ALL policy would silently keep a client bypass open.
DO $$
DECLARE
  signature text;
  fn record;
  members record;
BEGIN
  SELECT relowner, relforcerowsecurity INTO members
  FROM pg_class WHERE oid = 'public.workspace_members'::regclass;

  FOREACH signature IN ARRAY ARRAY[
    'public.workspace_accept_invite(text)',
    'public.is_workspace_admin(uuid,uuid)',
    'public.is_workspace_member(uuid,uuid)'
  ] LOOP
    SELECT p.prosecdef, p.proowner, r.rolsuper, r.rolbypassrls INTO fn
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = to_regprocedure(signature);
    IF NOT FOUND OR NOT fn.prosecdef THEN
      RAISE EXCEPTION 'Membership preflight: missing SECURITY DEFINER function %', signature;
    END IF;
    IF NOT (fn.rolsuper OR fn.rolbypassrls
            OR (fn.proowner = members.relowner AND NOT members.relforcerowsecurity)) THEN
      RAISE EXCEPTION 'Membership preflight: owner cannot bypass RLS for %', signature;
    END IF;
    IF NOT has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'Membership preflight: authenticated cannot execute %', signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.workspace_members'::regclass
      AND polpermissive AND polcmd IN ('a','*')
      AND (0::oid = ANY(polroles)
           OR (SELECT oid FROM pg_roles WHERE rolname='authenticated') = ANY(polroles))
      AND polname NOT IN ('Admin or self inserts member', 'Owners insert own membership')
  ) THEN
    RAISE EXCEPTION 'Membership preflight: unexpected permissive INSERT/ALL membership policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.workspaces'::regclass
      AND polpermissive AND polcmd IN ('a','*')
      AND (0::oid = ANY(polroles)
           OR (SELECT oid FROM pg_roles WHERE rolname='authenticated') = ANY(polroles))
      AND polname <> 'Admin creates workspace'
  ) THEN
    RAISE EXCEPTION 'Membership preflight: unexpected permissive INSERT/ALL workspace policy';
  END IF;
END $$;

DROP POLICY IF EXISTS "Admin or self inserts member" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners insert own membership" ON public.workspace_members;
CREATE POLICY "Owners insert own membership"
ON public.workspace_members
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND role = 'owner'
  AND EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_members.workspace_id
      AND w.owner_id = auth.uid()
  )
);

-- Preserve existing global-admin eligibility. Assigning another owner stays
-- available only to the validated service-role backend, not the public client.
ALTER POLICY "Admin creates workspace" ON public.workspaces
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  AND owner_id = auth.uid()
);

COMMIT;
