-- Phase 4: membership and invitation hardening; retain global legacy overrides.
BEGIN;
SELECT platform_private.require_cutover_ready();
DO $$ BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT (SELECT bootstrapped FROM platform_private.transition WHERE singleton)
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role='superadmin') THEN
    RAISE EXCEPTION 'explicit superadmin bootstrap is required before hardening';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.workspace_members'::regclass
      AND polpermissive AND polcmd IN ('a','w','d','*')
      AND polname NOT IN ('Admin or self inserts member','Admin updates members','Self leaves workspace','Owners insert own membership','Self leaves nonowned workspace')) THEN
    RAISE EXCEPTION 'unexpected membership write policy; reconcile real catalog first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
             WHERE m.role='owner' AND m.user_id<>w.owner_id) THEN
    RAISE EXCEPTION 'noncanonical owner membership requires explicit remediation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces w WHERE NOT EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner')) THEN
    RAISE EXCEPTION 'workspace missing canonical owner membership requires explicit remediation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_invites WHERE role<>'member' AND expires_at>now() AND uses<max_uses) THEN
    RAISE EXCEPTION 'pending privileged invites require explicit remediation';
  END IF;
END $$;

DROP POLICY IF EXISTS "Admin or self inserts member" ON public.workspace_members;
DROP POLICY IF EXISTS "Admin updates members" ON public.workspace_members;
DROP POLICY IF EXISTS "Self leaves workspace" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners insert own membership" ON public.workspace_members;
CREATE POLICY "Owners insert own membership" ON public.workspace_members
FOR INSERT TO authenticated WITH CHECK (
  user_id=auth.uid() AND role='owner'
  AND member_profile='operational'
  AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=workspace_id AND w.owner_id=auth.uid())
);
DROP POLICY IF EXISTS "Self leaves nonowned workspace" ON public.workspace_members;
CREATE POLICY "Self leaves nonowned workspace" ON public.workspace_members
FOR DELETE TO authenticated USING (
  user_id=auth.uid() AND NOT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id=workspace_id AND w.owner_id=auth.uid())
);
REVOKE UPDATE ON public.workspace_members FROM authenticated;

-- Canonical ownership is enforced for trusted service writes too. Parent
-- deletion may cascade; otherwise transfer owner_id before demoting/removing.
CREATE OR REPLACE FUNCTION platform_private.guard_canonical_owner_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE canonical uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT owner_id INTO canonical FROM public.workspaces WHERE id=OLD.workspace_id;
    IF FOUND AND OLD.user_id=canonical THEN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'transfer ownership before removing owner' USING ERRCODE='23514';
      END IF;
      IF NEW.workspace_id<>OLD.workspace_id OR NEW.user_id<>OLD.user_id OR NEW.role<>'owner' THEN
        RAISE EXCEPTION 'transfer ownership before changing owner membership' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP<>'DELETE' AND NEW.role='owner' THEN
    SELECT owner_id INTO canonical FROM public.workspaces WHERE id=NEW.workspace_id;
    IF canonical IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'noncanonical owner membership is not allowed' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS workspace_members_canonical_owner ON public.workspace_members;
CREATE TRIGGER workspace_members_canonical_owner BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION platform_private.guard_canonical_owner_membership();
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_one_owner ON public.workspace_members(workspace_id) WHERE role='owner';

-- Keep the existing bounded eligibility to create one's OWN workspace.
-- This is not platform administration and does not grant access to anyone else.
ALTER POLICY "Admin creates workspace" ON public.workspaces WITH CHECK (
  public.has_role(auth.uid(),'admin') AND owner_id=auth.uid()
);
CREATE OR REPLACE FUNCTION platform_private.protect_workspace_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND current_user<>'postgres' THEN
    RAISE EXCEPTION 'owner transfer requires validated server operation' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspaces_protect_owner ON public.workspaces;
CREATE TRIGGER workspaces_protect_owner BEFORE UPDATE OF owner_id ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION platform_private.protect_workspace_owner();

-- Existing invitation reads remain; all administrative writes move to RPCs.
DROP POLICY IF EXISTS "Admin creates invite" ON public.workspace_invites;
DROP POLICY IF EXISTS "Admin deletes invite" ON public.workspace_invites;
REVOKE INSERT,UPDATE,DELETE ON public.workspace_invites FROM authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.workspace_invites'::regclass AND conname='workspace_invites_member_only') THEN
    ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_member_only CHECK(role='member');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_accept_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); uemail text; inv public.workspace_invites%ROWTYPE; ws uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id=uid AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now());
  IF NOT FOUND THEN RAISE EXCEPTION 'account inactive' USING ERRCODE='42501'; END IF;
  -- Every mutation locks workspace before invite: invitation consumption,
  -- revocation and capacity/membership writes use the same lock order.
  SELECT workspace_id INTO ws FROM public.workspace_invites WHERE token=_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite invalid or expired'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR UPDATE;
  SELECT * INTO inv FROM public.workspace_invites WHERE token=_token AND workspace_id=ws FOR UPDATE;
  IF NOT FOUND OR inv.expires_at<=now() THEN RAISE EXCEPTION 'invite invalid or expired'; END IF;
  IF inv.uses>=inv.max_uses THEN RAISE EXCEPTION 'invite already used'; END IF;
  IF inv.email IS NOT NULL AND lower(inv.email)<>lower(uemail) THEN RAISE EXCEPTION 'invite is not for this account'; END IF;
  IF inv.role<>'member' THEN
    RAISE EXCEPTION 'privileged roles require explicit superadmin administration' USING ERRCODE='42501';
  END IF;
  -- Issuer must still be authorized. A former local admin's links lose authority.
  IF NOT platform_private.is_workspace_admin(ws,inv.invited_by)
     AND NOT platform_private.is_superadmin(inv.invited_by) THEN
    RAISE EXCEPTION 'invite issuer is no longer authorized' USING ERRCODE='42501';
  END IF;
  PERFORM platform_private.check_capacity(ws,uid);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(ws,uid,'member') ON CONFLICT DO NOTHING;
  UPDATE public.workspace_invites SET uses=uses+1,
    accepted_at=CASE WHEN max_uses=1 THEN now() ELSE accepted_at END WHERE id=inv.id;
  RETURN ws;
END $$;
REVOKE ALL ON FUNCTION public.workspace_accept_invite(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_accept_invite(text) TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_private FROM PUBLIC,anon,authenticated,service_role;
UPDATE platform_private.transition SET membership_hardened=true WHERE singleton;

COMMIT;
