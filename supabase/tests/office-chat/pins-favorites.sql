-- Synthetic fixtures in the network-none disposable database only (same fixtures as interactions.sql).
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') AS cid \gset
SELECT public.chat_send_message(:'cid','pin me','text','50000000-0000-4000-8000-000000000001');
SELECT public.chat_send_message(:'cid','pin me too','text','50000000-0000-4000-8000-000000000002');
SELECT public.chat_set_favorite(:'cid','50000000-0000-4000-8000-000000000001',true);
SELECT public.chat_set_favorite(:'cid','50000000-0000-4000-8000-000000000001',true);
SELECT public._chat_assert((SELECT count(*)=1 FROM public.chat_message_favorites WHERE message_id='50000000-0000-4000-8000-000000000001'),'favorite is idempotent and owned by the actor');
SELECT public.chat_set_pin(:'cid','50000000-0000-4000-8000-000000000001');
SELECT public._chat_assert((SELECT pinned_message_id='50000000-0000-4000-8000-000000000001' FROM public.chat_conversations WHERE id=:'cid'),'participant pins');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
SELECT public._chat_assert((SELECT count(*)=0 FROM public.chat_message_favorites),'other participant does not see favorite');
SELECT public._chat_assert((SELECT pinned_message_id='50000000-0000-4000-8000-000000000001' FROM public.chat_conversations WHERE id=:'cid'),'pin visible to both participants');
SELECT public.chat_set_pin(:'cid','50000000-0000-4000-8000-000000000002');
SELECT public._chat_assert((SELECT pinned_message_id='50000000-0000-4000-8000-000000000002' AND pinned_by=auth.uid() FROM public.chat_conversations WHERE id=:'cid'),'second pin replaces first');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
SELECT public._chat_rejected(format('SELECT public.chat_set_pin(%L,%L)',:'cid','50000000-0000-4000-8000-000000000002'),'42501','third user (even Superadmin) cannot pin');
SELECT public._chat_rejected(format('SELECT public.chat_set_favorite(%L,%L,true)',:'cid','50000000-0000-4000-8000-000000000002'),'42501','third user cannot favorite');
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003') AS other_cid \gset
SELECT public._chat_rejected(format('SELECT public.chat_set_pin(%L,%L)',:'other_cid','50000000-0000-4000-8000-000000000002'),'42501','cross-conversation pin blocked');
SELECT public.chat_cancel_message(:'cid','50000000-0000-4000-8000-000000000002');
SELECT public._chat_assert((SELECT pinned_message_id IS NULL FROM public.chat_conversations WHERE id=:'cid'),'cancel auto-unpins');
SELECT public._chat_rejected(format('SELECT public.chat_set_pin(%L,%L)',:'cid','50000000-0000-4000-8000-000000000002'),'PCH02','cancelled message cannot be pinned');
SELECT public.chat_set_pin(:'cid','50000000-0000-4000-8000-000000000001');
SELECT public.chat_set_pin(:'cid',NULL);
SELECT public._chat_assert((SELECT pinned_message_id IS NULL FROM public.chat_conversations WHERE id=:'cid'),'unpin');
SELECT public.chat_set_favorite(:'cid','50000000-0000-4000-8000-000000000001',false);
SELECT public._chat_assert((SELECT count(*)=0 FROM public.chat_message_favorites),'unfavorite');
RESET ROLE;
SELECT public._chat_assert(NOT has_function_privilege('anon','public.chat_set_pin(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.chat_set_favorite(uuid,uuid,boolean)','EXECUTE'),'pin/favorite RPCs not callable by anon');
