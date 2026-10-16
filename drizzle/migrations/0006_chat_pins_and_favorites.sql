ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS pinned_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_by uuid,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

CREATE TABLE public.chat_message_favorites (
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX chat_message_favorites_user_conv_idx
  ON public.chat_message_favorites (user_id, conversation_id, created_at DESC);
REVOKE ALL ON public.chat_message_favorites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_message_favorites TO authenticated;
GRANT ALL ON public.chat_message_favorites TO service_role;
ALTER TABLE public.chat_message_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Chat users read own favorites" ON public.chat_message_favorites
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.chat_can_access_conversation(conversation_id));

CREATE OR REPLACE FUNCTION public.chat_set_pin(cid uuid, message_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE c public.chat_conversations; msg public.chat_messages;
BEGIN
  c:=public.chat_lock_conversation(cid);
  IF message_id IS NULL THEN
    UPDATE public.chat_conversations SET pinned_message_id=NULL,pinned_by=NULL,pinned_at=NULL,
      updated_at=clock_timestamp() WHERE id=cid RETURNING * INTO c;
  ELSE
    SELECT * INTO msg FROM public.chat_messages m WHERE m.id=chat_set_pin.message_id AND m.conversation_id=cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
    IF msg.deleted_at IS NOT NULL OR msg.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Message removed' USING ERRCODE='PCH02';
    END IF;
    UPDATE public.chat_conversations SET pinned_message_id=msg.id,pinned_by=auth.uid(),
      pinned_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=cid RETURNING * INTO c;
  END IF;
  RETURN jsonb_build_object('conversation_id',c.id,'pinned_message_id',c.pinned_message_id,
    'pinned_by',c.pinned_by,'pinned_at',c.pinned_at);
END $function$;

CREATE OR REPLACE FUNCTION public.chat_set_favorite(cid uuid, message_id uuid, favorite boolean)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE c public.chat_conversations; msg public.chat_messages;
BEGIN
  c:=public.chat_lock_conversation(cid);
  SELECT * INTO msg FROM public.chat_messages m WHERE m.id=chat_set_favorite.message_id AND m.conversation_id=cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
  IF favorite THEN
    IF msg.deleted_at IS NOT NULL OR msg.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Message removed' USING ERRCODE='PCH02';
    END IF;
    INSERT INTO public.chat_message_favorites(message_id,conversation_id,user_id)
      VALUES (msg.id,cid,auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_message_favorites f
      WHERE f.message_id=msg.id AND f.user_id=auth.uid();
  END IF;
  RETURN favorite;
END $function$;

CREATE OR REPLACE FUNCTION public.chat_unpin_removed_message()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
     OR (NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL) THEN
    UPDATE public.chat_conversations SET pinned_message_id=NULL,pinned_by=NULL,pinned_at=NULL,
      updated_at=clock_timestamp()
      WHERE id=NEW.conversation_id AND pinned_message_id=NEW.id;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER chat_messages_unpin_removed AFTER UPDATE OF deleted_at, cancelled_at
  ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.chat_unpin_removed_message();

REVOKE ALL ON FUNCTION public.chat_set_pin(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_set_favorite(uuid,uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_unpin_removed_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_set_pin(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_set_favorite(uuid,uuid,boolean) TO authenticated;