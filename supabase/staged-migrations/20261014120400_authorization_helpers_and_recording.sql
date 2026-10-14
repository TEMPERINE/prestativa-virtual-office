-- Phase 5: apply after bootstrap and the new application handlers are ready.
BEGIN;
SELECT platform_private.require_cutover_ready();

-- SET ROLE is established by PostgREST, not by a client-supplied actor_id.
-- The maintenance SQL session is also trusted. current_user alone must NOT
-- be used here: it becomes postgres inside every SECURITY DEFINER call.
CREATE OR REPLACE FUNCTION platform_private.is_service_context()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user='postgres')
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT (platform_private.is_service_context()
    OR (auth.uid() IS NOT NULL AND (_user_id=auth.uid()
      OR platform_private.is_workspace_member(_workspace_id,auth.uid()))))
    AND platform_private.is_workspace_member(_workspace_id,_user_id)
$$;
CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT (platform_private.is_service_context()
    OR (auth.uid() IS NOT NULL AND (_user_id=auth.uid()
      OR platform_private.is_workspace_member(_workspace_id,auth.uid()))))
    AND platform_private.is_workspace_admin(_workspace_id,_user_id)
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT (platform_private.is_service_context() OR _user_id=auth.uid())
    AND platform_private.has_role(_user_id,_role)
$$;
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT email FROM auth.users WHERE id=auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.workspace_members_guard_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.member_profile='strategic'
     AND (TG_OP='INSERT' OR OLD.member_profile IS DISTINCT FROM NEW.member_profile)
     AND auth.uid() IS NOT NULL
     AND NOT platform_private.is_workspace_admin(NEW.workspace_id,auth.uid())
     AND NOT public.platform_is_superadmin() THEN NEW.member_profile:='operational'; END IF;
  RETURN NEW;
END $$;

-- Bounded recording capability is distinct from platform administration.
-- Never permits auto-joining RTC or recording without local membership.
CREATE OR REPLACE FUNCTION public.can_record_meeting(_user_id uuid,_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT (platform_private.is_service_context()
    OR (auth.uid() IS NOT NULL AND _user_id=auth.uid()))
  AND (
    EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.user_id=_user_id AND m.workspace_id=_workspace_id
        AND (m.role IN ('owner','admin') OR m.member_profile='strategic'))
    OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=_workspace_id AND w.owner_id=_user_id)
    OR (platform_private.is_workspace_member(_workspace_id,_user_id)
      AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=_user_id
                    AND r.role IN ('admin','master','supervisor','superadmin')))
  )
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid,uuid),
  public.is_workspace_admin(uuid,uuid),public.has_role(uuid,public.app_role),
  public.current_user_email(),public.can_record_meeting(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid,uuid),
  public.is_workspace_admin(uuid,uuid),public.has_role(uuid,public.app_role),
  public.current_user_email(),public.can_record_meeting(uuid,uuid)
  TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.workspace_members_guard_profile() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_private FROM PUBLIC,anon,authenticated,service_role;
UPDATE platform_private.transition SET helpers_hardened=true WHERE singleton;
COMMIT;
