-- Chat MVP ONLY. Staged for explicit review; NOT applied to the real database.
-- Independent of Superadmin reconciliation and hardening phases 4/5/6.
DO $$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Chat installation requires trusted postgres'; END IF;
END $$;

CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  participant_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_message_seq bigint NOT NULL DEFAULT 0 CHECK(last_message_seq>=0),
  participant_a_read_seq bigint NOT NULL DEFAULT 0 CHECK(participant_a_read_seq>=0 AND participant_a_read_seq<=last_message_seq),
  participant_b_read_seq bigint NOT NULL DEFAULT 0 CHECK(participant_b_read_seq>=0 AND participant_b_read_seq<=last_message_seq),
  CONSTRAINT chat_conversations_canonical_pair CHECK(participant_a<participant_b),
  CONSTRAINT chat_conversations_unique_pair UNIQUE(workspace_id,participant_a,participant_b)
);
CREATE INDEX chat_conversations_a_inbox ON public.chat_conversations(workspace_id,participant_a,last_message_at DESC);
CREATE INDEX chat_conversations_b_inbox ON public.chat_conversations(workspace_id,participant_b,last_message_at DESC);

CREATE TABLE public.chat_messages (
  -- Renderer-generated UUID is only an idempotency key, never an actor identity.
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000 AND body~'[^[:space:]]'),
  message_type text NOT NULL CHECK(message_type IN('text','sticker')),
  seq bigint NOT NULL CHECK(seq>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_sequence UNIQUE(conversation_id,seq),
  CONSTRAINT chat_messages_static_sticker CHECK(message_type<>'sticker' OR body IN('hello','thanks','coffee','celebrate'))
);
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_conversations,public.chat_messages FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.chat_conversations,public.chat_messages TO authenticated;

-- Scoped read helper; no arbitrary user_id or global role override.
CREATE FUNCTION public.chat_can_access_conversation(cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.chat_conversations c
    WHERE c.id=cid AND auth.uid() IN(c.participant_a,c.participant_b)
      AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=c.participant_a)
      AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=c.participant_b))
$$;
CREATE POLICY "Chat participants read conversations" ON public.chat_conversations
  FOR SELECT TO authenticated USING(public.chat_can_access_conversation(id));
CREATE POLICY "Chat participants read messages" ON public.chat_messages
  FOR SELECT TO authenticated USING(public.chat_can_access_conversation(conversation_id));
-- No client INSERT/UPDATE/DELETE policies; mutations use validated RPCs only.

-- Internal helper. Lock order: workspace -> memberships in UUID order -> chat.
-- Locks prevent concurrent membership/workspace removal during a validated write.
CREATE FUNCTION public.chat_lock_conversation(cid uuid)
RETURNS public.chat_conversations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; members integer;
BEGIN
  SELECT * INTO c FROM public.chat_conversations x
    WHERE x.id=cid AND auth.uid() IN(x.participant_a,x.participant_b);
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=c.workspace_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id
    AND m.user_id IN(c.participant_a,c.participant_b) ORDER BY m.user_id FOR KEY SHARE;
  GET DIAGNOSTICS members=ROW_COUNT;
  IF members<>2 THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.chat_conversations x WHERE x.id=cid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
  RETURN c;
END $$;

CREATE FUNCTION public.chat_start_conversation(ws uuid,peer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid(); a uuid; b uuid; result uuid; members integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF peer IS NULL OR peer=actor THEN RAISE EXCEPTION 'Choose another participant' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=ws FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id IN(actor,peer)
    ORDER BY m.user_id FOR KEY SHARE;
  GET DIAGNOSTICS members=ROW_COUNT;
  IF members<>2 THEN RAISE EXCEPTION 'Both participants must belong to this workspace' USING ERRCODE='42501'; END IF;
  a:=LEAST(actor,peer); b:=GREATEST(actor,peer);
  INSERT INTO public.chat_conversations(workspace_id,participant_a,participant_b) VALUES(ws,a,b)
    ON CONFLICT(workspace_id,participant_a,participant_b) DO NOTHING RETURNING id INTO result;
  IF result IS NULL THEN
    SELECT id INTO result FROM public.chat_conversations c WHERE c.workspace_id=ws AND c.participant_a=a AND c.participant_b=b;
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.chat_send_message(cid uuid,content text,kind text,message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; msg public.chat_messages; at_time timestamptz; next_seq bigint;
BEGIN
  IF message_id IS NULL OR content IS NULL OR kind IS NULL
    OR kind NOT IN('text','sticker') OR char_length(content) NOT BETWEEN 1 AND 4000
    OR content!~'[^[:space:]]'
    OR (kind='sticker' AND content NOT IN('hello','thanks','coffee','celebrate')) THEN
    RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';
  END IF;
  c:=public.chat_lock_conversation(cid);
  SELECT * INTO msg FROM public.chat_messages WHERE id=message_id;
  IF FOUND THEN
    IF msg.conversation_id<>cid OR msg.sender_id<>auth.uid() OR msg.body<>content OR msg.message_type<>kind THEN
      RAISE EXCEPTION 'Message id already used' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(msg);
  END IF;
  -- Timestamp follows serialization order, never the pre-lock invocation time.
  at_time:=GREATEST(clock_timestamp(),c.last_message_at);
  UPDATE public.chat_conversations SET last_message_seq=last_message_seq+1,last_message_at=at_time,updated_at=at_time
    WHERE id=cid RETURNING last_message_seq INTO next_seq;
  INSERT INTO public.chat_messages(id,conversation_id,sender_id,body,message_type,seq,created_at)
    VALUES(message_id,cid,auth.uid(),content,kind,next_seq,at_time) RETURNING * INTO msg;
  RETURN to_jsonb(msg);
END $$;

CREATE FUNCTION public.chat_mark_read(cid uuid,through_seq bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; seen bigint;
BEGIN
  IF through_seq IS NULL OR through_seq<0 THEN RAISE EXCEPTION 'Invalid read cursor' USING ERRCODE='22023'; END IF;
  c:=public.chat_lock_conversation(cid);
  seen:=LEAST(through_seq,c.last_message_seq);
  IF auth.uid()=c.participant_a THEN
    UPDATE public.chat_conversations SET participant_a_read_seq=seen,updated_at=clock_timestamp()
      WHERE id=cid AND participant_a_read_seq<seen;
  ELSE
    UPDATE public.chat_conversations SET participant_b_read_seq=seen,updated_at=clock_timestamp()
      WHERE id=cid AND participant_b_read_seq<seen;
  END IF;
END $$;

CREATE FUNCTION public.chat_list_conversations(ws uuid)
RETURNS TABLE(
  id uuid,workspace_id uuid,participant_a uuid,participant_b uuid,created_at timestamptz,
  last_message_at timestamptz,last_message_seq bigint,read_seq bigint,unread_count bigint,
  peer_id uuid,peer_name text,peer_sprite_id text,peer_color text,
  last_body text,last_type text,last_sender_id uuid
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT c.id,c.workspace_id,c.participant_a,c.participant_b,c.created_at,c.last_message_at,c.last_message_seq,
    CASE WHEN c.participant_a=auth.uid() THEN c.participant_a_read_seq ELSE c.participant_b_read_seq END,
    (SELECT count(*) FROM public.chat_messages m WHERE m.conversation_id=c.id AND m.sender_id<>auth.uid()
      AND m.seq>CASE WHEN c.participant_a=auth.uid() THEN c.participant_a_read_seq ELSE c.participant_b_read_seq END),
    peer.uid,COALESCE(p.display_name,'Colega'),p.sprite_id,COALESCE(p.avatar_color,''),
    latest.body,latest.message_type,latest.sender_id
  FROM public.chat_conversations c
  CROSS JOIN LATERAL(SELECT CASE WHEN c.participant_a=auth.uid() THEN c.participant_b ELSE c.participant_a END AS uid) peer
  LEFT JOIN public.profiles p ON p.id=peer.uid
  LEFT JOIN LATERAL(SELECT m.body,m.message_type,m.sender_id FROM public.chat_messages m
    WHERE m.conversation_id=c.id ORDER BY m.seq DESC LIMIT 1) latest ON true
  WHERE c.workspace_id=ws AND auth.uid() IN(c.participant_a,c.participant_b)
    AND public.chat_can_access_conversation(c.id)
  ORDER BY COALESCE(c.last_message_at,c.created_at) DESC,c.id
$$;

REVOKE ALL ON FUNCTION public.chat_lock_conversation(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.chat_can_access_conversation(uuid),public.chat_start_conversation(uuid,uuid),
  public.chat_send_message(uuid,text,text,uuid),public.chat_mark_read(uuid,bigint),public.chat_list_conversations(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chat_can_access_conversation(uuid),public.chat_start_conversation(uuid,uuid),
  public.chat_send_message(uuid,text,text,uuid),public.chat_mark_read(uuid,bigint),public.chat_list_conversations(uuid)
  TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'Existing Supabase Realtime publication required; stop and review';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND puballtables) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations,public.chat_messages;
  END IF;
END $$;