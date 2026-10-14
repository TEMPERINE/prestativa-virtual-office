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
-- Conservative function inventory: any exact legacy role literal is reviewed,
-- even in a private/custom schema or a routine without client EXECUTE. It also
-- catches dollar-quoted role literals. System schemas are excluded; aggregates
-- are not passed to pg_get_functiondef. Unknown routines are NEVER rewritten.
-- Names alone do not authorize exceptions: full signature, exact reviewed body,
-- owner, language, security/search_path and effective EXECUTE must all match.
DO $function_gate$
DECLARE unreviewed text;
BEGIN
  WITH allowlist(signature,body_md5,language,authenticated_execute,service_execute,reason) AS (
    VALUES
      ('public.platform_bootstrap_superadmin()','90db0a3d1c05b421e7fda7a7d75c870e','plpgsql',false,true,'one-time validated intersection; no runtime legacy override'),
      ('public.platform_recover_superadmin(uuid)','9e8dcf760fb482e0f54e740cc349931a','plpgsql',false,true,'service-only recovery and transitional legacy transfer'),
      ('public.platform_set_global_role(uuid,public.app_role,boolean)','071f6df901039a3f478c37e54c313391','plpgsql',true,false,'explicit Superadmin guard; preserves own legacy access until retirement'),
      ('platform_private.is_workspace_admin(uuid,uuid)','d162652f8b76df8316fb1778cab40a01','sql',false,false,'local workspace owner/admin lookup; no global override'),
      ('platform_private.require_membership_manager(uuid,uuid,public.workspace_role)','674e922a9732825e1fa9432fe81ac388','plpgsql',false,false,'Superadmin or bounded local common-member management'),
      ('public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role)','60eecad14c0e6bc30dfb4a99de637e6e','plpgsql',true,false,'Superadmin-only atomic transfer; admin is a local former-owner role'),
      ('public.can_record_meeting(uuid,uuid)','1a1a6f0c94a3a5cf3a73e35b6f66d54e','sql',true,true,'recording capability bound to workspace membership/canonical ownership')
  ), functions AS MATERIALIZED (
    SELECT p.oid,p.prosrc,p.proowner,p.prosecdef,p.proconfig,p.prokind,
      l.lanname,n.nspname,p.proname,pg_catalog.pg_get_functiondef(p.oid) AS definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.prokind IN ('f','p') AND n.nspname<>'information_schema'
      AND n.nspname !~ '^pg_'
  ), violations AS (
    SELECT pg_catalog.format('%I.%I(%s)',f.nspname,f.proname,
      pg_catalog.oidvectortypes(p.proargtypes)) AS signature
    FROM functions f JOIN pg_catalog.pg_proc p ON p.oid=f.oid
    LEFT JOIN allowlist a ON f.oid=pg_catalog.to_regprocedure(a.signature)
    WHERE (f.definition ~* $literal$'(admin|master)'$literal$
      OR f.definition ~* $dollar$\$[a-z_0-9]*\$[[:space:]]*(admin|master)[[:space:]]*\$[a-z_0-9]*\$$dollar$
      OR a.signature IS NOT NULL)
    AND (a.signature IS NULL
      OR pg_catalog.md5(f.prosrc)<>a.body_md5
      OR f.prokind<>'f' OR f.proowner<>'postgres'::regrole
      OR NOT f.prosecdef OR f.lanname<>a.language
      OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')<>a.authenticated_execute
      OR pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')<>a.service_execute)
    UNION ALL
    SELECT a.signature FROM allowlist a
    WHERE NOT EXISTS(SELECT 1 FROM functions f WHERE f.oid=pg_catalog.to_regprocedure(a.signature))
  )
  SELECT pg_catalog.string_agg(signature,', ' ORDER BY signature) INTO unreviewed FROM violations;
  IF unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'unreviewed legacy authorization function remains; cutover aborted'
      USING ERRCODE='23514',DETAIL=unreviewed,
        HINT='Review listed signatures explicitly; do not rewrite or broaden the allowlist automatically.';
  END IF;
END $function_gate$;

UPDATE platform_private.transition SET retired=true WHERE singleton;

COMMIT;
