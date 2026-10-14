-- Phase 10: apply ONLY after authenticated acknowledgement + operator rollout attestation.
BEGIN;
SELECT platform_private.require_cutover_ready();
DO $$ BEGIN
  IF NOT (SELECT membership_hardened AND helpers_hardened FROM platform_private.transition WHERE singleton) THEN
    RAISE EXCEPTION 'complete membership/helper hardening before retiring overrides';
  END IF;
END $$;
ALTER POLICY "Admin or owner updates workspace" ON public.workspaces USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
ALTER POLICY "Admin or owner deletes workspace" ON public.workspaces USING(owner_id=auth.uid());

-- No replacement broad "superadmin" RLS policies. Global operations use
-- authenticated server guards/RPCs and narrowly trusted service-role handlers.
DROP POLICY IF EXISTS "Admin can manage map_overrides" ON public.map_overrides;
DROP POLICY IF EXISTS "Admin can manage custom_props" ON public.custom_props;
ALTER POLICY "Workspace admin upserts map" ON public.map_overrides WITH CHECK (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
);
ALTER POLICY "Workspace admin updates map" ON public.map_overrides USING (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
) WITH CHECK (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
);
ALTER POLICY "Workspace admin deletes map" ON public.map_overrides USING (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
);
ALTER POLICY "Admin inserts custom_props" ON public.custom_props WITH CHECK (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
);
ALTER POLICY "Admin updates custom_props" ON public.custom_props USING (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
) WITH CHECK (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
);
ALTER POLICY "Admin deletes custom_props" ON public.custom_props USING (
  public.is_workspace_admin(workspace_id,auth.uid())
  OR (public.is_workspace_member(workspace_id,auth.uid()) AND public.has_role(auth.uid(),'supervisor'))
);

DROP POLICY IF EXISTS "Admin manages skins" ON public.sprite_skins;
ALTER POLICY "Read global or member workspace skins" ON public.sprite_skins USING (
  workspace_id IS NULL OR public.is_workspace_member(workspace_id,auth.uid())
);
DROP POLICY IF EXISTS "Admin writes sprite sheets" ON storage.objects;
DROP POLICY IF EXISTS "Admin updates sprite sheets" ON storage.objects;
DROP POLICY IF EXISTS "Admin deletes sprite sheets" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage groups" ON public.account_groups;
-- Deliberately leave the broad group-name read as a separate issue, not a
-- source of administrative writes. This migration doesn't resolve that audit.
DROP POLICY IF EXISTS "Admins manage signup invites" ON public.signup_invites;
REVOKE INSERT,UPDATE,DELETE ON public.signup_invites FROM authenticated;
-- signup_invite_redeem still consumes validated tokens under its trusted owner.

ALTER POLICY "members read save points" ON public.map_save_points USING (public.is_workspace_member(workspace_id,auth.uid()));
ALTER POLICY "admins create save points" ON public.map_save_points WITH CHECK (
  public.is_workspace_admin(workspace_id,auth.uid()) AND created_by=auth.uid()
);
ALTER POLICY "admins delete save points" ON public.map_save_points USING (public.is_workspace_admin(workspace_id,auth.uid()));
ALTER POLICY "Admins read workspace rtc events" ON public.rtc_events USING (
  workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id,auth.uid())
);

CREATE OR REPLACE FUNCTION public.can_read_meeting_participants(_meeting_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT (platform_private.is_service_context() OR _user_id=auth.uid())
  AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id=_meeting_id AND (
    platform_private.is_workspace_admin(m.workspace_id,_user_id)
    OR (platform_private.is_workspace_member(m.workspace_id,_user_id)
      AND EXISTS (SELECT 1 FROM public.meeting_recording_shares s
                  WHERE s.meeting_id=m.id AND s.recipient_id=_user_id))
  ))
$$;
REVOKE ALL ON FUNCTION public.can_read_meeting_participants(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_meeting_participants(uuid,uuid) TO authenticated,service_role;
-- Fail closed if unreviewed global checks remain anywhere else in the catalog.
-- Only the bounded self-creation/operational recording capabilities above are
-- allowlisted; further findings require human inspection and explicit SQL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname IN ('public','storage')
    AND (COALESCE(qual,'')~* 'has_role.*''(admin|master)'''
      OR COALESCE(with_check,'')~* 'has_role.*''(admin|master)''')
    AND NOT (schemaname='public' AND tablename='workspaces' AND policyname='Admin creates workspace')) THEN
    RAISE EXCEPTION 'unreviewed legacy global policy remains; cutover aborted';
  END IF;
END $$;
UPDATE platform_private.transition SET retired=true WHERE singleton;

COMMIT;
