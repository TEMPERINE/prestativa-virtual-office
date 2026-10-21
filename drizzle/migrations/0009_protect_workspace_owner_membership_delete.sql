-- Canonical owner membership cannot be removed directly, including privileged writes.
-- Existing workspace deletion cascades and owner-transfer RPC remain unchanged.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.workspace_members'::regclass
      AND polpermissive AND polcmd IN ('d','*')
      AND polname <> 'Self leaves workspace'
  ) THEN
    RAISE EXCEPTION 'Unexpected membership DELETE/ALL policy; review before applying owner protection';
  END IF;
END $$;

ALTER POLICY "Self leaves workspace" ON public.workspace_members
USING (
  (user_id = auth.uid() OR public.is_workspace_admin(workspace_id, auth.uid()))
  AND NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_members.workspace_id AND w.owner_id = workspace_members.user_id
  )
);

CREATE OR REPLACE FUNCTION public.guard_workspace_owner_membership_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE canonical_owner uuid;
BEGIN
  -- Serialize with the existing transfer flow. During parent ON DELETE CASCADE,
  -- the deleted workspace is no longer visible, so its membership can cascade.
  SELECT w.owner_id INTO canonical_owner
  FROM public.workspaces w WHERE w.id = OLD.workspace_id FOR UPDATE;
  IF FOUND AND canonical_owner = OLD.user_id THEN
    RAISE EXCEPTION 'Transfer ownership or delete the workspace before removing its owner membership'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workspace_owner_membership_delete() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER workspace_members_protect_owner_delete
BEFORE DELETE ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_owner_membership_delete();