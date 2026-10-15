-- Incremental Chat interactions ONLY. Prepared, NOT applied to any real database.
-- Requires the installed Chat MVP; never rerun that migration or security stages.
BEGIN;
DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Chat installation requires trusted postgres'; END IF;
  IF to_regclass('public.chat_messages') IS NULL OR to_regprocedure('public.chat_lock_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Installed Chat MVP required; stop and review';
  END IF;
END $$;

ALTER TABLE public.chat_conversations
  ADD COLUMN participant_a_delivered_seq bigint NOT NULL DEFAULT 0,
  ADD COLUMN participant_b_delivered_seq bigint NOT NULL DEFAULT 0;
-- Existing read receipts prove prior delivery, never infer delivery from last_message_seq.
UPDATE public.chat_conversations SET participant_a_delivered_seq=participant_a_read_seq,
  participant_b_delivered_seq=participant_b_read_seq;
ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_a_delivery_order CHECK(participant_a_delivered_seq BETWEEN participant_a_read_seq AND last_message_seq),
  ADD CONSTRAINT chat_b_delivery_order CHECK(participant_b_delivered_seq BETWEEN participant_b_read_seq AND last_message_seq);
ALTER TABLE public.chat_messages
  ALTER COLUMN body DROP NOT NULL,
  ADD COLUMN reply_to_message_id uuid,
  ADD COLUMN is_forwarded boolean NOT NULL DEFAULT false,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT chat_message_identity_conversation UNIQUE(id,conversation_id),
  ADD CONSTRAINT chat_reply_same_conversation FOREIGN KEY(reply_to_message_id,conversation_id)
    REFERENCES public.chat_messages(id,conversation_id),
  ADD CONSTRAINT chat_cancelled_content CHECK(
    (cancelled_at IS NULL AND deleted_at IS NULL AND body IS NOT NULL) OR
    (cancelled_at IS NOT NULL AND deleted_at IS NULL AND body IS NULL) OR
    (cancelled_at IS NULL AND deleted_at IS NOT NULL AND body IS NULL));
CREATE INDEX chat_messages_reply ON public.chat_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

CREATE TABLE public.chat_message_reactions (
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text CHECK(emoji IS NULL OR (char_length(emoji) BETWEEN 1 AND 32 AND emoji~'[^[:space:]]')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  PRIMARY KEY(message_id,user_id),
  CONSTRAINT chat_reaction_message_conversation FOREIGN KEY(message_id,conversation_id)
    REFERENCES public.chat_messages(id,conversation_id) ON DELETE CASCADE
);
CREATE INDEX chat_reactions_conversation ON public.chat_message_reactions(conversation_id,message_id);
ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_message_reactions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.chat_message_reactions TO authenticated;
CREATE POLICY "Chat participants read reactions" ON public.chat_message_reactions
  FOR SELECT TO authenticated USING(public.chat_can_access_conversation(conversation_id));

-- Internal writer: retained UUID retries return the same row, including a tombstone.
CREATE FUNCTION public.chat_insert_message(cid uuid,content text,kind text,message_id uuid,reply_to uuid,forwarded boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; msg public.chat_messages; target public.chat_messages; at_time timestamptz; next_seq bigint;
BEGIN
  IF message_id IS NULL OR content IS NULL OR kind IS NULL OR forwarded IS NULL
    OR kind NOT IN('text','sticker') OR char_length(content) NOT BETWEEN 1 AND 4000 OR content!~'[^[:space:]]'
    OR (kind='sticker' AND content NOT IN('hello','thanks','coffee','celebrate')) THEN
    RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';
  END IF;
  c:=public.chat_lock_conversation(cid);
  SELECT * INTO msg FROM public.chat_messages m WHERE m.id=message_id;
  IF FOUND THEN
    IF msg.conversation_id<>cid OR msg.sender_id<>auth.uid()
      OR msg.reply_to_message_id IS DISTINCT FROM reply_to OR msg.is_forwarded<>forwarded
      OR (msg.cancelled_at IS NULL AND msg.deleted_at IS NULL AND (msg.body<>content OR msg.message_type<>kind)) THEN
      RAISE EXCEPTION 'Message id already used' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(msg);
  END IF;
  IF reply_to IS NOT NULL THEN
    SELECT * INTO target FROM public.chat_messages m WHERE m.id=reply_to AND m.conversation_id=cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reply unavailable' USING ERRCODE='22023'; END IF;
    IF target.cancelled_at IS NOT NULL OR target.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Message cancelled' USING ERRCODE='PCH02'; END IF;
  END IF;
  at_time:=GREATEST(clock_timestamp(),c.last_message_at);
  UPDATE public.chat_conversations SET last_message_seq=last_message_seq+1,last_message_at=at_time,updated_at=at_time
    WHERE id=cid RETURNING last_message_seq INTO next_seq;
  INSERT INTO public.chat_messages(id,conversation_id,sender_id,body,message_type,seq,created_at,reply_to_message_id,is_forwarded)
    VALUES(message_id,cid,auth.uid(),content,kind,next_seq,at_time,reply_to,forwarded) RETURNING * INTO msg;
  RETURN to_jsonb(msg);
END $$;
CREATE FUNCTION public.chat_send_message_v2(cid uuid,content text,kind text,message_id uuid,reply_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.chat_insert_message(cid,content,kind,message_id,reply_to,false)
$$;
CREATE OR REPLACE FUNCTION public.chat_send_message(cid uuid,content text,kind text,message_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.chat_insert_message(cid,content,kind,message_id,NULL,false)
$$;

CREATE FUNCTION public.chat_mark_delivered(cid uuid,through_seq bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; seen bigint;
BEGIN
  IF through_seq IS NULL OR through_seq<0 THEN RAISE EXCEPTION 'Invalid delivery cursor' USING ERRCODE='22023'; END IF;
  c:=public.chat_lock_conversation(cid);
  seen:=LEAST(through_seq,c.last_message_seq);
  IF auth.uid()=c.participant_a THEN
    UPDATE public.chat_conversations SET participant_a_delivered_seq=seen,updated_at=clock_timestamp()
      WHERE id=cid AND participant_a_delivered_seq<seen;
  ELSE
    UPDATE public.chat_conversations SET participant_b_delivered_seq=seen,updated_at=clock_timestamp()
      WHERE id=cid AND participant_b_delivered_seq<seen;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.chat_mark_read(cid uuid,through_seq bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; seen bigint;
BEGIN
  IF through_seq IS NULL OR through_seq<0 THEN RAISE EXCEPTION 'Invalid read cursor' USING ERRCODE='22023'; END IF;
  c:=public.chat_lock_conversation(cid);
  seen:=LEAST(through_seq,c.last_message_seq);
  IF auth.uid()=c.participant_a THEN
    UPDATE public.chat_conversations SET participant_a_read_seq=seen,participant_a_delivered_seq=GREATEST(participant_a_delivered_seq,seen),updated_at=clock_timestamp()
      WHERE id=cid AND participant_a_read_seq<seen;
  ELSE
    UPDATE public.chat_conversations SET participant_b_read_seq=seen,participant_b_delivered_seq=GREATEST(participant_b_delivered_seq,seen),updated_at=clock_timestamp()
      WHERE id=cid AND participant_b_read_seq<seen;
  END IF;
END $$;

CREATE FUNCTION public.chat_set_reaction(cid uuid,message_id uuid,emoji text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE msg public.chat_messages; result public.chat_message_reactions; chosen text:=emoji;
BEGIN
  PERFORM public.chat_lock_conversation(cid);
  SELECT * INTO msg FROM public.chat_messages m WHERE m.id=message_id AND m.conversation_id=cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
  IF msg.cancelled_at IS NOT NULL OR msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Message cancelled' USING ERRCODE='PCH02'; END IF;
  IF chosen IS NOT NULL AND (char_length(chosen) NOT BETWEEN 1 AND 32 OR chosen!~'[^[:space:]]') THEN
    RAISE EXCEPTION 'Invalid reaction' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.chat_message_reactions AS r(message_id,conversation_id,user_id,emoji)
    VALUES(message_id,cid,auth.uid(),chosen)
    ON CONFLICT ON CONSTRAINT chat_message_reactions_pkey DO UPDATE SET emoji=excluded.emoji,revision=r.revision+1
      WHERE r.emoji IS DISTINCT FROM excluded.emoji RETURNING * INTO result;
  IF NOT FOUND THEN SELECT * INTO result FROM public.chat_message_reactions r WHERE r.message_id=chat_set_reaction.message_id AND r.user_id=auth.uid(); END IF;
  UPDATE public.chat_conversations SET updated_at=clock_timestamp() WHERE id=cid;
  RETURN to_jsonb(result);
END $$;

CREATE FUNCTION public.chat_cancel_message(cid uuid,message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; msg public.chat_messages; peer_read bigint;
BEGIN
  c:=public.chat_lock_conversation(cid);
  SELECT * INTO msg FROM public.chat_messages m WHERE m.id=message_id AND m.conversation_id=cid;
  IF NOT FOUND OR msg.sender_id<>auth.uid() THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
  IF msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Message deleted' USING ERRCODE='PCH02'; END IF;
  IF msg.cancelled_at IS NOT NULL THEN RETURN to_jsonb(msg); END IF;
  peer_read:=CASE WHEN auth.uid()=c.participant_a THEN c.participant_b_read_seq ELSE c.participant_a_read_seq END;
  IF peer_read>=msg.seq THEN RAISE EXCEPTION 'Message already read' USING ERRCODE='PCH01'; END IF;
  UPDATE public.chat_messages SET body=NULL,cancelled_at=clock_timestamp()
    WHERE id=message_id RETURNING * INTO msg;
  UPDATE public.chat_message_reactions SET emoji=NULL,revision=revision+1
    WHERE chat_message_reactions.message_id=chat_cancel_message.message_id AND emoji IS NOT NULL;
  UPDATE public.chat_conversations SET updated_at=clock_timestamp() WHERE id=cid;
  RETURN to_jsonb(msg);
END $$;

-- Post-read delete: distinct from cancellation; sender-only and row retained.
CREATE FUNCTION public.chat_delete_message(cid uuid,message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.chat_conversations; msg public.chat_messages; peer_read bigint;
BEGIN
  c:=public.chat_lock_conversation(cid);
  SELECT * INTO msg FROM public.chat_messages m WHERE m.id=message_id AND m.conversation_id=cid;
  IF NOT FOUND OR msg.sender_id<>auth.uid() THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
  IF msg.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Message cancelled' USING ERRCODE='PCH02'; END IF;
  IF msg.deleted_at IS NOT NULL THEN RETURN to_jsonb(msg); END IF;
  peer_read:=CASE WHEN auth.uid()=c.participant_a THEN c.participant_b_read_seq ELSE c.participant_a_read_seq END;
  IF peer_read<msg.seq THEN RAISE EXCEPTION 'Message not yet read' USING ERRCODE='PCH03'; END IF;
  UPDATE public.chat_messages SET body=NULL,deleted_at=clock_timestamp()
    WHERE id=message_id RETURNING * INTO msg;
  UPDATE public.chat_message_reactions SET emoji=NULL,revision=revision+1
    WHERE chat_message_reactions.message_id=chat_delete_message.message_id AND emoji IS NOT NULL;
  UPDATE public.chat_conversations SET updated_at=clock_timestamp() WHERE id=cid;
  RETURN to_jsonb(msg);
END $$;

CREATE FUNCTION public.chat_forward_message(cid uuid,message_id uuid,peer uuid,forward_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.chat_messages; source_chat public.chat_conversations; target uuid;
BEGIN
  -- Read only a participant's source before creating anything; all writes roll back on error.
  SELECT * INTO source_chat FROM public.chat_conversations c
    WHERE c.id=cid AND auth.uid() IN(c.participant_a,c.participant_b);
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
  target:=public.chat_start_conversation(source_chat.workspace_id,peer);
  -- Both forward directions take the same ordered conversation locks.
  PERFORM 1 FROM public.chat_conversations c WHERE c.id IN(cid,target) ORDER BY c.id FOR UPDATE;
  PERFORM public.chat_lock_conversation(cid);
  SELECT * INTO source FROM public.chat_messages m WHERE m.id=message_id AND m.conversation_id=cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
  IF source.cancelled_at IS NOT NULL OR source.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Message cancelled' USING ERRCODE='PCH02'; END IF;
  RETURN public.chat_insert_message(target,source.body,source.message_type,forward_id,NULL,true);
END $$;

CREATE FUNCTION public.chat_list_conversations_v2(ws uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(legacy)||jsonb_build_object(
    'own_delivered_seq',CASE WHEN auth.uid()=c.participant_a THEN c.participant_a_delivered_seq ELSE c.participant_b_delivered_seq END,
    'peer_delivered_seq',CASE WHEN auth.uid()=c.participant_a THEN c.participant_b_delivered_seq ELSE c.participant_a_delivered_seq END,
    'peer_read_seq',CASE WHEN auth.uid()=c.participant_a THEN c.participant_b_read_seq ELSE c.participant_a_read_seq END,
    'last_deleted_at',(SELECT m.deleted_at FROM public.chat_messages m WHERE m.conversation_id=c.id ORDER BY m.seq DESC LIMIT 1),
    'last_cancelled_at',(SELECT m.cancelled_at FROM public.chat_messages m WHERE m.conversation_id=c.id ORDER BY m.seq DESC LIMIT 1)
  ) ORDER BY COALESCE(c.last_message_at,c.created_at) DESC,c.id),'[]'::jsonb)
  FROM public.chat_list_conversations(ws) legacy JOIN public.chat_conversations c ON c.id=legacy.id
$$;
CREATE FUNCTION public.chat_list_contacts(ws uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.user_id,'name',COALESCE(p.display_name,'Colega'),'sprite_id',p.sprite_id)
    ORDER BY COALESCE(p.display_name,'Colega'),m.user_id),'[]'::jsonb) INTO result
    FROM public.workspace_members m LEFT JOIN public.profiles p ON p.id=m.user_id
    WHERE m.workspace_id=ws AND m.user_id<>auth.uid();
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.chat_insert_message(uuid,text,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.chat_send_message_v2(uuid,text,text,uuid,uuid),public.chat_send_message(uuid,text,text,uuid),
  public.chat_mark_delivered(uuid,bigint),public.chat_mark_read(uuid,bigint),public.chat_set_reaction(uuid,uuid,text),
  public.chat_cancel_message(uuid,uuid),public.chat_delete_message(uuid,uuid),public.chat_forward_message(uuid,uuid,uuid,uuid),
  public.chat_list_conversations_v2(uuid),public.chat_list_contacts(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chat_send_message_v2(uuid,text,text,uuid,uuid),public.chat_send_message(uuid,text,text,uuid),
  public.chat_mark_delivered(uuid,bigint),public.chat_mark_read(uuid,bigint),public.chat_set_reaction(uuid,uuid,text),
  public.chat_cancel_message(uuid,uuid),public.chat_delete_message(uuid,uuid),public.chat_forward_message(uuid,uuid,uuid,uuid),
  public.chat_list_conversations_v2(uuid),public.chat_list_contacts(uuid) TO authenticated;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'Existing Supabase Realtime publication required; stop and review';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND puballtables) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
  END IF;
END $$;
COMMIT;
