-- Synthetic fixtures in the network-none disposable database only.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') AS cid \gset
SELECT public._chat_assert(jsonb_typeof(public.chat_list_conversations_v2('10000000-0000-4000-8000-000000000001'))='array','versioned inbox preserves array contract');
SELECT public.chat_send_message_v2(:'cid','original private text','text','40000000-0000-4000-8000-000000000001',NULL);
SELECT seq AS first_seq FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000001' \gset
SELECT public.chat_set_reaction(:'cid','40000000-0000-4000-8000-000000000001','❤️');
SELECT public._chat_assert((SELECT emoji='❤️' AND user_id=auth.uid() AND revision=1 FROM public.chat_message_reactions WHERE message_id='40000000-0000-4000-8000-000000000001'),'reaction adds with server-derived actor');
SELECT public.chat_set_reaction(:'cid','40000000-0000-4000-8000-000000000001','👍');
SELECT public.chat_set_reaction(:'cid','40000000-0000-4000-8000-000000000001','👍');
SELECT public._chat_assert((SELECT count(*)=1 AND bool_and(emoji='👍' AND revision=2) FROM public.chat_message_reactions WHERE message_id='40000000-0000-4000-8000-000000000001'),'reaction changes in place and repeated set is idempotent');
SELECT public.chat_set_reaction(:'cid','40000000-0000-4000-8000-000000000001',NULL);
SELECT public._chat_assert((SELECT emoji IS NULL AND revision=3 FROM public.chat_message_reactions WHERE message_id='40000000-0000-4000-8000-000000000001'),'reaction removes using versioned tombstone');
SELECT public.chat_send_message_v2(:'cid','same conversation reply','text','40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001');
SELECT public._chat_assert((SELECT reply_to_message_id='40000000-0000-4000-8000-000000000001' AND NOT is_forwarded FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000002'),'reply metadata points to same conversation');
SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003') AS other_cid \gset
SELECT public._chat_rejected(format('SELECT public.chat_send_message_v2(%L,%L,%L,%L,%L)',:'other_cid','cross','text','40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001'),'22023','cross-conversation reply is blocked');
SELECT public._chat_assert((SELECT count(*)=2 FROM jsonb_array_elements(public.chat_list_contacts('10000000-0000-4000-8000-000000000001'))),'contacts contain only other workspace members');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
SELECT public._chat_rejected(format('SELECT public.chat_set_reaction(%L,%L,%L)',:'cid','40000000-0000-4000-8000-000000000001','😂'),'42501','third user even Superadmin cannot react');
SELECT public._chat_rejected(format('SELECT public.chat_cancel_message(%L,%L)',:'cid','40000000-0000-4000-8000-000000000001'),'42501','third user cannot cancel');
SELECT public._chat_rejected(format('SELECT public.chat_forward_message(%L,%L,%L,%L)',:'cid','40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000010'),'42501','third user cannot forward');
SELECT public._chat_assert((SELECT count(*)=0 FROM public.chat_message_reactions WHERE message_id='40000000-0000-4000-8000-000000000001'),'RLS hides third-party reactions');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
SELECT public._chat_rejected($$SELECT public.chat_list_contacts('10000000-0000-4000-8000-000000000001')$$,'42501','nonmember cannot list workspace contacts');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public.chat_forward_message(:'cid','40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004') AS forwarded \gset
SELECT public._chat_assert((:'forwarded'::jsonb->>'id')<>'40000000-0000-4000-8000-000000000001' AND (:'forwarded'::jsonb->>'conversation_id')::uuid=:'other_cid'::uuid AND :'forwarded'::jsonb->>'body'='original private text' AND (:'forwarded'::jsonb->>'is_forwarded')::boolean AND :'forwarded'::jsonb->>'reply_to_message_id' IS NULL,'forward creates independent message without reply/source reference');
SELECT public._chat_assert(NOT(:'forwarded'::jsonb ?| ARRAY['source_id','source_conversation_id','original_sender_id','original_conversation_id']),'forward JSON does not reveal original conversation or author');
SELECT public.chat_forward_message(:'cid','40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004');
SELECT public._chat_assert((SELECT count(*)=1 FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000004'),'forward retry cannot duplicate');
SELECT public._chat_rejected(format('SELECT public.chat_forward_message(%L,%L,%L,%L)',:'cid','40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005'),'42501','forward to nonmember blocked');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
SELECT public._chat_rejected(format('SELECT public.chat_cancel_message(%L,%L)',:'cid','40000000-0000-4000-8000-000000000001'),'42501','recipient cannot cancel sender message');
SELECT public.chat_mark_delivered(:'cid',:'first_seq');
SELECT public.chat_mark_delivered(:'cid',1);
SELECT public._chat_assert((SELECT participant_b_delivered_seq=:'first_seq' AND participant_b_read_seq<:'first_seq' FROM public.chat_conversations WHERE id=:'cid'),'delivered advances monotonically without changing read');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public._chat_assert((SELECT (r->>'peer_delivered_seq')::bigint=:'first_seq' AND (r->>'peer_read_seq')::bigint<:'first_seq' FROM jsonb_array_elements(public.chat_list_conversations_v2('10000000-0000-4000-8000-000000000001')) r WHERE r->>'id'=:'cid'),'sender receipt comes from peer persisted cursors');
SELECT public.chat_set_reaction(:'cid','40000000-0000-4000-8000-000000000001','🙏');
SELECT public.chat_cancel_message(:'cid','40000000-0000-4000-8000-000000000001');
SELECT public.chat_cancel_message(:'cid','40000000-0000-4000-8000-000000000001');
SELECT public._chat_assert((SELECT body IS NULL AND cancelled_at IS NOT NULL FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000001'),'sender cancels delivered unread message and content is removed');
SELECT public._chat_assert((SELECT emoji IS NULL FROM public.chat_message_reactions WHERE message_id='40000000-0000-4000-8000-000000000001'),'cancellation invalidates reactions');
SELECT public._chat_assert((SELECT body='original private text' AND is_forwarded FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000004'),'previous forwarded copy remains independent of original cancellation');
SELECT public._chat_rejected(format('SELECT public.chat_set_reaction(%L,%L,%L)',:'cid','40000000-0000-4000-8000-000000000001','👍'),'PCH02','cancelled message cannot be reacted to');
SELECT public._chat_rejected(format('SELECT public.chat_send_message_v2(%L,%L,%L,%L,%L)',:'cid','reply','text','40000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000001'),'PCH02','cancelled message cannot be replied to');
SELECT public._chat_rejected(format('SELECT public.chat_forward_message(%L,%L,%L,%L)',:'cid','40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000007'),'PCH02','cancelled message cannot be forwarded');
SELECT public.chat_send_message(:'cid','must remain after read','text','40000000-0000-4000-8000-000000000008');
SELECT seq AS read_seq FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000008' \gset
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
SELECT public.chat_mark_read(:'cid',:'read_seq');
SELECT public._chat_assert((SELECT participant_b_read_seq=:'read_seq' AND participant_b_delivered_seq>=participant_b_read_seq FROM public.chat_conversations WHERE id=:'cid'),'read also proves delivery and both cursors remain ordered');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public._chat_rejected(format('SELECT public.chat_cancel_message(%L,%L)',:'cid','40000000-0000-4000-8000-000000000008'),'PCH01','already-read cancellation gets specific atomic error');
SELECT public._chat_assert((SELECT body='must remain after read' AND cancelled_at IS NULL FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000008'),'rejected cancellation does not redact content');
SELECT public.chat_send_message(:'cid','unread','text','40000000-0000-4000-8000-000000000009');
SELECT public.chat_cancel_message(:'cid','40000000-0000-4000-8000-000000000009');
SELECT public._chat_assert((SELECT body IS NULL FROM public.chat_messages WHERE id='40000000-0000-4000-8000-000000000009'),'undelivered unread message can be cancelled');
RESET ROLE;
SELECT public._chat_assert(NOT has_table_privilege('authenticated','public.chat_message_reactions','INSERT') AND NOT has_table_privilege('authenticated','public.chat_message_reactions','UPDATE') AND NOT has_table_privilege('authenticated','public.chat_message_reactions','DELETE'),'reaction writes are RPC-only');
SELECT public._chat_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.chat_message_reactions'::regclass),'reaction RLS enabled');
SELECT public._chat_assert((SELECT count(*)=1 AND bool_and(cmd='SELECT') FROM pg_policies WHERE schemaname='public' AND tablename='chat_message_reactions'),'only scoped SELECT reaction policy exists');
SELECT public._chat_assert(EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='chat_message_reactions'),'reactions added to existing scoped Realtime publication');
SELECT public._chat_assert(NOT has_function_privilege('anon','public.chat_cancel_message(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.chat_cancel_message(uuid,uuid)','EXECUTE') AND has_function_privilege('authenticated','public.chat_cancel_message(uuid,uuid)','EXECUTE'),'new RPC grants restricted to authenticated');
SELECT public._chat_assert(NOT has_function_privilege('authenticated','public.chat_lock_conversation(uuid)','EXECUTE'),'locking helper remains private');
GRANT INSERT ON public.chat_message_reactions TO authenticated;
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public._chat_rejected(format('INSERT INTO public.chat_message_reactions(message_id,conversation_id,user_id,emoji) VALUES(%L,%L,%L,%L)','40000000-0000-4000-8000-000000000008',:'cid','00000000-0000-4000-8000-000000000002','👍'),'42501','RLS prevents forged reaction user even with accidental table grant');
RESET ROLE;
REVOKE INSERT ON public.chat_message_reactions FROM authenticated;

SELECT public._chat_assert(NOT has_function_privilege('authenticated','public.chat_insert_message(uuid,text,text,uuid,uuid,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.chat_insert_message(uuid,text,text,uuid,uuid,boolean)','EXECUTE'),'internal writer cannot be used to forge forwarded metadata');
SELECT public._chat_rejected(format('INSERT INTO public.chat_messages(id,conversation_id,sender_id,body,message_type,seq,reply_to_message_id) VALUES(gen_random_uuid(),%L,%L,%L,%L,999999,%L)',:'other_cid','00000000-0000-4000-8000-000000000001','invalid','text','40000000-0000-4000-8000-000000000008'),'23503','same-conversation reply FK also protects direct trusted writes');
SELECT public._chat_rejected(format('INSERT INTO public.chat_message_reactions(message_id,conversation_id,user_id,emoji) VALUES(%L,%L,%L,%L)','40000000-0000-4000-8000-000000000008',:'other_cid','00000000-0000-4000-8000-000000000001','👍'),'23503','reaction FK cannot claim another conversation');
SELECT public._chat_rejected(format('INSERT INTO public.chat_messages(id,conversation_id,sender_id,body,message_type,seq) VALUES(gen_random_uuid(),%L,%L,NULL,%L,999999)',:'cid','00000000-0000-4000-8000-000000000001','text'),'23514','null body requires a cancellation tombstone');
