-- Anonymous (visitor) identities never become profiles or global members.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN RETURN NEW; END IF;
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  RETURN NEW;
END; $$;

CREATE TABLE public.workspace_visitor_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  intended_name text,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  activated_at timestamptz,
  activated_by uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visitor_invite_window CHECK (expires_at > starts_at),
  CONSTRAINT visitor_invite_max CHECK (expires_at <= starts_at + interval '366 days')
);
GRANT SELECT ON public.workspace_visitor_invites TO authenticated;
GRANT ALL ON public.workspace_visitor_invites TO service_role;
ALTER TABLE public.workspace_visitor_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace admins read visitor invites" ON public.workspace_visitor_invites
  FOR SELECT TO authenticated USING (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE TABLE public.workspace_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invite_id uuid NOT NULL UNIQUE REFERENCES public.workspace_visitor_invites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text NOT NULL CHECK (btrim(display_name) <> '' AND length(display_name) <= 60),
  sprite_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_visitors_user_idx ON public.workspace_visitors(user_id, workspace_id);
GRANT SELECT ON public.workspace_visitors TO authenticated;
GRANT ALL ON public.workspace_visitors TO service_role;
ALTER TABLE public.workspace_visitors ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_workspace_visitor(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_visitors v
    WHERE v.workspace_id=_workspace_id AND v.user_id=_user_id
      AND v.revoked_at IS NULL AND v.expires_at > now())
$$;
CREATE OR REPLACE FUNCTION public.can_access_workspace_runtime(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_workspace_member(_workspace_id,_user_id)
      OR public.is_active_workspace_visitor(_workspace_id,_user_id)
$$;
REVOKE ALL ON FUNCTION public.is_active_workspace_visitor(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_workspace_runtime(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_workspace_visitor(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_runtime(uuid,uuid) TO authenticated, service_role;

CREATE POLICY "Visitor reads own visit" ON public.workspace_visitors
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Runtime peers read visitors" ON public.workspace_visitors
  FOR SELECT TO authenticated USING (public.can_access_workspace_runtime(workspace_id, auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_visitors;

-- Minimal runtime reads for active visitors (members unchanged).
CREATE POLICY "Active visitors read positions" ON public.positions
  FOR SELECT TO authenticated USING (public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitor manages own position" ON public.positions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND public.is_active_workspace_visitor(workspace_id, auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitors read workspace" ON public.workspaces
  FOR SELECT TO authenticated USING (public.is_active_workspace_visitor(id, auth.uid()));
CREATE POLICY "Active visitors read map" ON public.map_overrides
  FOR SELECT TO authenticated USING (public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitors read custom_props" ON public.custom_props
  FOR SELECT TO authenticated USING (public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitors read prop_states" ON public.prop_states
  FOR SELECT TO authenticated USING (public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitors read claims" ON public.workspace_claims
  FOR SELECT TO authenticated USING (public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitors read workspace skins" ON public.sprite_skins
  FOR SELECT TO authenticated USING (workspace_id IS NOT NULL AND public.is_active_workspace_visitor(workspace_id, auth.uid()));
CREATE POLICY "Active visitors read member profiles" ON public.profiles
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = profiles.id AND public.is_active_workspace_visitor(wm.workspace_id, auth.uid())));

-- Single office session: members or active visitors.
CREATE OR REPLACE FUNCTION public.claim_office_session(_session_id uuid, _workspace_id uuid)
RETURNS TABLE(session_id uuid, generation bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF _session_id IS NULL OR _workspace_id IS NULL THEN RAISE EXCEPTION 'invalid arguments' USING ERRCODE = '22023'; END IF;
  IF NOT public.can_access_workspace_runtime(_workspace_id, uid) THEN
    RAISE EXCEPTION 'not a workspace member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO public.office_sessions AS s (user_id, session_id, generation, workspace_id, active, claimed_at, updated_at)
  VALUES (uid, _session_id, 1, _workspace_id, true, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET session_id = EXCLUDED.session_id, generation = s.generation + 1,
        workspace_id = EXCLUDED.workspace_id, active = true, claimed_at = now(), updated_at = now()
  RETURNING s.session_id, s.generation;
END; $$;

-- Realtime: visitors get presence/movement/map, never meeting-idle.
CREATE OR REPLACE FUNCTION public.rtc_can_access_topic(_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); parts text[];
BEGIN
  IF uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;
  parts := string_to_array(_topic, ':');
  IF array_length(parts, 1) <> 3 THEN RETURN false; END IF;
  IF parts[1] = 'workspace' AND parts[2] ~* '^[0-9a-f-]{36}$' THEN
    IF parts[3] IN ('presence','movement','map') THEN
      RETURN public.can_access_workspace_runtime(parts[2]::uuid, uid);
    ELSIF parts[3] = 'meeting-idle' THEN
      RETURN public.is_workspace_member(parts[2]::uuid, uid);
    END IF;
  END IF;
  IF parts[1] = 'user' AND parts[3] = 'session' AND parts[2] ~* '^[0-9a-f-]{36}$' THEN
    RETURN parts[2]::uuid = uid;
  END IF;
  RETURN false;
END; $$;

-- RPCs ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visitor_create_invite(ws uuid, _name text, _starts_at timestamptz, _expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); tok text; st timestamptz; iid uuid;
BEGIN
  IF uid IS NULL OR NOT public.is_workspace_admin(ws, uid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _expires_at IS NULL THEN RAISE EXCEPTION 'expires_at required' USING ERRCODE='22023'; END IF;
  st := GREATEST(COALESCE(_starts_at, now()), now() - interval '1 minute');
  IF _expires_at <= st OR _expires_at <= now() THEN RAISE EXCEPTION 'invalid window' USING ERRCODE='22023'; END IF;
  IF _expires_at > st + interval '366 days' THEN RAISE EXCEPTION 'window too long' USING ERRCODE='22023'; END IF;
  tok := translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_');
  INSERT INTO public.workspace_visitor_invites(workspace_id,created_by,token_hash,intended_name,starts_at,expires_at)
  VALUES (ws, uid, encode(extensions.digest(tok,'sha256'),'hex'), NULLIF(left(btrim(COALESCE(_name,'')),60),''), st, _expires_at)
  RETURNING id INTO iid;
  RETURN jsonb_build_object('id', iid, 'token', tok, 'starts_at', st, 'expires_at', _expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.visitor_peek(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i public.workspace_visitor_invites; uid uuid := auth.uid(); v public.workspace_visitors;
BEGIN
  SELECT * INTO i FROM public.workspace_visitor_invites
   WHERE token_hash = encode(extensions.digest(COALESCE(_token,''),'sha256'),'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;
  IF i.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status','revoked'); END IF;
  IF i.activated_by IS NOT NULL THEN
    IF uid IS NOT NULL AND i.activated_by = uid THEN
      SELECT * INTO v FROM public.workspace_visitors WHERE invite_id = i.id;
      IF v.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status','revoked'); END IF;
      IF v.expires_at <= now() THEN RETURN jsonb_build_object('status','expired'); END IF;
      RETURN jsonb_build_object('status','mine','workspace_id',i.workspace_id,'expires_at',v.expires_at);
    END IF;
    RETURN jsonb_build_object('status','used');
  END IF;
  IF i.expires_at <= now() THEN RETURN jsonb_build_object('status','expired'); END IF;
  IF i.starts_at > now() THEN RETURN jsonb_build_object('status','scheduled','starts_at',i.starts_at); END IF;
  RETURN jsonb_build_object('status','valid','starts_at',i.starts_at,'expires_at',i.expires_at,
    'intended_name',i.intended_name,
    'workspace_name',(SELECT name FROM public.workspaces WHERE id=i.workspace_id),
    'inviter_name',(SELECT display_name FROM public.profiles WHERE id=i.created_by));
END; $$;

CREATE OR REPLACE FUNCTION public.visitor_activate(_token text, _name text, _sprite_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); i public.workspace_visitor_invites; nm text := left(btrim(COALESCE(_name,'')),60);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='28000'; END IF;
  IF EXISTS(SELECT 1 FROM public.workspace_members WHERE user_id=uid) THEN RAISE EXCEPTION 'members cannot be visitors' USING ERRCODE='42501'; END IF;
  IF nm = '' THEN RAISE EXCEPTION 'name required' USING ERRCODE='22023'; END IF;
  IF COALESCE(_sprite_id,'') !~ '^[a-zA-Z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'invalid sprite' USING ERRCODE='22023'; END IF;
  SELECT * INTO i FROM public.workspace_visitor_invites
   WHERE token_hash = encode(extensions.digest(COALESCE(_token,''),'sha256'),'hex') FOR UPDATE;
  IF NOT FOUND OR i.revoked_at IS NOT NULL OR i.expires_at <= now() OR i.starts_at > now() THEN
    RAISE EXCEPTION 'invite unavailable' USING ERRCODE='42501'; END IF;
  IF i.activated_by IS NOT NULL THEN
    IF i.activated_by = uid THEN RETURN i.workspace_id; END IF;
    RAISE EXCEPTION 'invite already used' USING ERRCODE='42501';
  END IF;
  UPDATE public.workspace_visitor_invites SET activated_at=now(), activated_by=uid, updated_at=now() WHERE id=i.id;
  INSERT INTO public.workspace_visitors(workspace_id,invite_id,user_id,display_name,sprite_id,expires_at)
  VALUES (i.workspace_id, i.id, uid, nm, _sprite_id, i.expires_at);
  RETURN i.workspace_id;
END; $$;

CREATE OR REPLACE FUNCTION public.visitor_extend(_invite_id uuid, _expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i public.workspace_visitor_invites;
BEGIN
  SELECT * INTO i FROM public.workspace_visitor_invites WHERE id=_invite_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_workspace_admin(i.workspace_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF i.revoked_at IS NOT NULL OR i.expires_at <= now() THEN RAISE EXCEPTION 'visit ended' USING ERRCODE='22023'; END IF;
  IF _expires_at IS NULL OR _expires_at <= now() OR _expires_at <= i.starts_at OR _expires_at > i.starts_at + interval '366 days' THEN
    RAISE EXCEPTION 'invalid window' USING ERRCODE='22023'; END IF;
  UPDATE public.workspace_visitor_invites SET expires_at=_expires_at, updated_at=now() WHERE id=i.id;
  UPDATE public.workspace_visitors SET expires_at=_expires_at WHERE invite_id=i.id;
END; $$;

CREATE OR REPLACE FUNCTION public.visitor_revoke(_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i public.workspace_visitor_invites;
BEGIN
  SELECT * INTO i FROM public.workspace_visitor_invites WHERE id=_invite_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_workspace_admin(i.workspace_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.workspace_visitor_invites SET revoked_at=COALESCE(revoked_at,now()), updated_at=now() WHERE id=i.id;
  UPDATE public.workspace_visitors SET revoked_at=COALESCE(revoked_at,now()) WHERE invite_id=i.id;
  UPDATE public.office_sessions SET active=false, updated_at=now()
   WHERE workspace_id=i.workspace_id AND user_id IN (SELECT user_id FROM public.workspace_visitors WHERE invite_id=i.id);
  DELETE FROM public.positions WHERE workspace_id=i.workspace_id AND user_id IN (SELECT user_id FROM public.workspace_visitors WHERE invite_id=i.id);
END; $$;

CREATE OR REPLACE FUNCTION public.visitor_list(ws uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_workspace_admin(ws, auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,'name',COALESCE(v.display_name,i.intended_name),'starts_at',i.starts_at,'expires_at',i.expires_at,
    'activated_at',i.activated_at,'revoked_at',i.revoked_at,'visitor_user_id',v.user_id,
    'inviter_name',p.display_name,'created_at',i.created_at) ORDER BY i.created_at DESC)
    FROM public.workspace_visitor_invites i
    LEFT JOIN public.workspace_visitors v ON v.invite_id=i.id
    LEFT JOIN public.profiles p ON p.id=i.created_by
    WHERE i.workspace_id=ws AND i.created_at > now() - interval '90 days'), '[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.visitor_create_invite(uuid,text,timestamptz,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visitor_activate(text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visitor_extend(uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visitor_revoke(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visitor_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visitor_peek(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_create_invite(uuid,text,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_activate(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_extend(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_revoke(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_peek(text) TO anon, authenticated;
