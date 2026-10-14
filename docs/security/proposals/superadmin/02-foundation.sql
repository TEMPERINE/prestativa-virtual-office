-- PROPOSAL ONLY. Additive stage: no existing override or policy is retired.
-- Preflight must confirm auth.users.deleted_at/banned_until exist and function
-- owner postgres is an appropriate trusted, RLS-bypassing owner in this project.
BEGIN;
DO $$ BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'review trusted postgres ownership before installing this proposal';
  END IF;
END $$;
CREATE SCHEMA platform_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE platform_private.transition (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  bootstrapped boolean NOT NULL DEFAULT false,
  acknowledged_by uuid,
  application_commit text,
  membership_hardened boolean NOT NULL DEFAULT false,
  retired boolean NOT NULL DEFAULT false
);
INSERT INTO platform_private.transition DEFAULT VALUES;
CREATE TABLE platform_private.admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  target_id uuid,
  workspace_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;
-- Exactly one assignment; recovery replaces it atomically rather than banning
-- the old account and making a second assignment.
CREATE UNIQUE INDEX user_roles_one_superadmin ON public.user_roles(role)
  WHERE role = 'superadmin';

CREATE FUNCTION platform_private.is_superadmin(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id=r.user_id
    WHERE r.user_id=uid AND r.role='superadmin'
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
  )
$$;
CREATE FUNCTION public.platform_is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT platform_private.is_superadmin(auth.uid())
$$;

-- INVOKER is intentional: inside the privileged functions current_user is
-- their trusted owner, while a client cannot forge that identity using a GUC.
CREATE FUNCTION platform_private.protect_superadmin_role()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.role='superadmin')
     OR (TG_OP <> 'DELETE' AND NEW.role='superadmin') THEN
    IF current_user <> 'postgres'
       OR COALESCE(current_setting('prestativa.superadmin_maintenance', true),'') <> 'on' THEN
      RAISE EXCEPTION 'superadmin assignment requires controlled recovery' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER user_roles_protect_superadmin
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION platform_private.protect_superadmin_role();
-- TRUNCATE bypasses RLS and row triggers, including FK cascade protection.
REVOKE TRUNCATE ON public.user_roles FROM service_role,authenticated,anon,PUBLIC;
CREATE FUNCTION platform_private.protect_superadmin_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role='superadmin') THEN
    RAISE EXCEPTION 'recover superadmin before truncating protected tables' USING ERRCODE='42501';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER user_roles_protect_superadmin_truncate BEFORE TRUNCATE ON public.user_roles
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.protect_superadmin_truncate();
CREATE TRIGGER auth_users_protect_superadmin_truncate BEFORE TRUNCATE ON auth.users
FOR EACH STATEMENT EXECUTE FUNCTION platform_private.protect_superadmin_truncate();

CREATE FUNCTION platform_private.protect_superadmin_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=OLD.id AND role='superadmin') THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'recover superadmin before deleting this account' USING ERRCODE='42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.deleted_at IS NOT NULL
       OR NEW.banned_until > now() THEN
      RAISE EXCEPTION 'recover superadmin before disabling this account' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER auth_users_protect_superadmin
BEFORE UPDATE OR DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION platform_private.protect_superadmin_account();

CREATE FUNCTION public.platform_bootstrap_superadmin()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE candidate uuid; admins integer; masters integer; intersection_count integer;
BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT bootstrapped FROM platform_private.transition WHERE singleton)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE role='superadmin') THEN
    RAISE EXCEPTION 'bootstrap already performed; use controlled recovery' USING ERRCODE='23514';
  END IF;
  SELECT count(DISTINCT user_id) FILTER (WHERE role='admin'),
         count(DISTINCT user_id) FILTER (WHERE role='master')
    INTO admins, masters FROM public.user_roles;
  SELECT count(*) INTO intersection_count FROM public.user_roles a
    JOIN public.user_roles m ON m.user_id=a.user_id AND m.role='master'
    WHERE a.role='admin';
  IF admins<>1 OR masters<>1 OR intersection_count<>1 THEN
    RAISE EXCEPTION 'role inventory changed; bootstrap aborted' USING ERRCODE='23514';
  END IF;
  SELECT a.user_id INTO candidate FROM public.user_roles a
    JOIN public.user_roles m ON m.user_id=a.user_id AND m.role='master'
    JOIN auth.users u ON u.id=a.user_id
    WHERE a.role='admin' AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR UPDATE OF u;
  IF candidate IS NULL THEN
    RAISE EXCEPTION 'bootstrap candidate is not active' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('prestativa.superadmin_maintenance','on',true);
  INSERT INTO public.user_roles(user_id,role) VALUES(candidate,'superadmin');
  PERFORM set_config('prestativa.superadmin_maintenance','off',true);
  UPDATE platform_private.transition SET bootstrapped=true WHERE singleton;
  INSERT INTO platform_private.admin_audit(target_id,action) VALUES(candidate,'superadmin.bootstrap');
  RETURN jsonb_build_object('assigned',true,'superadmin_count',1);
END $$;

CREATE FUNCTION public.platform_recover_superadmin(replacement uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE old_holder uuid;
BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT (SELECT bootstrapped FROM platform_private.transition WHERE singleton) THEN
    RAISE EXCEPTION 'bootstrap the confirmed intersection before any recovery' USING ERRCODE='23514';
  END IF;
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM auth.users WHERE id=replacement AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery target is not active' USING ERRCODE='23514';
  END IF;
  SELECT user_id INTO old_holder FROM public.user_roles WHERE role='superadmin';
  IF old_holder=replacement THEN
    RAISE EXCEPTION 'target already holds superadmin' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('prestativa.superadmin_maintenance','on',true);
  DELETE FROM public.user_roles WHERE role='superadmin';
  INSERT INTO public.user_roles(user_id,role) VALUES(replacement,'superadmin');
  PERFORM set_config('prestativa.superadmin_maintenance','off',true);
  -- During transition the old application still requires these legacy labels.
  -- Transfer them explicitly in this SERVICE-ONLY emergency procedure, keeping
  -- one privileged holder. After retirement they no longer grant authority.
  IF NOT (SELECT retired FROM platform_private.transition WHERE singleton) THEN
    DELETE FROM public.user_roles WHERE user_id=old_holder AND role IN ('admin','master');
    INSERT INTO public.user_roles(user_id,role) VALUES(replacement,'admin'),(replacement,'master')
      ON CONFLICT DO NOTHING;
  END IF;
  UPDATE platform_private.transition SET bootstrapped=true, acknowledged_by=NULL,
    application_commit=NULL WHERE singleton;
  INSERT INTO platform_private.admin_audit(target_id,action)
    VALUES(replacement,'superadmin.recovery');
  RETURN jsonb_build_object('recovered',true,'superadmin_count',1);
END $$;

CREATE FUNCTION public.platform_acknowledge_superadmin_access()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.platform_is_superadmin() THEN
    RAISE EXCEPTION 'superadmin required' USING ERRCODE='42501';
  END IF;
  UPDATE platform_private.transition SET acknowledged_by=auth.uid() WHERE singleton;
  RETURN jsonb_build_object('superadmin',true,'legacy_retired',
    (SELECT retired FROM platform_private.transition WHERE singleton));
END $$;

-- Operator attestation, NOT automated proof that the UI was tested. Call only
-- after recorded access/guard/UI homologation at this exact application commit.
CREATE FUNCTION public.platform_authorize_cutover(application_commit text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF application_commit !~ '^[0-9a-f]{40}$' OR application_commit IS NULL THEN
    RAISE EXCEPTION 'exact application commit required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_private.transition
                  WHERE singleton AND bootstrapped
                    AND platform_private.is_superadmin(acknowledged_by)) THEN
    RAISE EXCEPTION 'new access has not been acknowledged' USING ERRCODE='23514';
  END IF;
  UPDATE platform_private.transition SET application_commit=platform_authorize_cutover.application_commit
    WHERE singleton;
END $$;

CREATE FUNCTION platform_private.require_cutover_ready()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- Hold to COMMIT of 04+05, excluding a concurrent recovery/attestation.
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM platform_private.transition
    WHERE singleton AND bootstrapped AND application_commit IS NOT NULL
      AND platform_private.is_superadmin(acknowledged_by)) THEN
    RAISE EXCEPTION 'cutover blocked: confirm new access and application rollout first' USING ERRCODE='23514';
  END IF;
END $$;

ALTER FUNCTION public.platform_bootstrap_superadmin() OWNER TO postgres;
ALTER FUNCTION public.platform_recover_superadmin(uuid) OWNER TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_bootstrap_superadmin(),
  public.platform_recover_superadmin(uuid), public.platform_authorize_cutover(text),
  public.platform_is_superadmin(), public.platform_acknowledge_superadmin_access()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_bootstrap_superadmin(),
  public.platform_recover_superadmin(uuid), public.platform_authorize_cutover(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_is_superadmin(),
  public.platform_acknowledge_superadmin_access() TO authenticated;
COMMIT;
