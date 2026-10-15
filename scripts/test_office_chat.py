"""Chat authorization in disposable PostgreSQL ONLY: no remote DB options/ports.

Existing schema shapes use archived SQL; no Superadmin/staged security SQL is run.
Auth/JWT and Supabase Realtime delivery are not provided by this local harness.
"""
import argparse
import json
import os
import re
import subprocess
import time
from test_workspace_membership import ROOT, IMAGE, bootstrap

MIGRATION = ROOT / 'supabase/staged-migrations/20261014220000_office_chat_mvp.sql'
TESTS = ROOT / 'supabase/tests/office-chat'


def run():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',action='store_true',help='Expect regression failure without the new chat SQL')
    parser.add_argument('--interactions',action='store_true',help='Also test staged incremental interactions in the disposable DB')
    parser.add_argument('--interactions-baseline',action='store_true',help='Run interaction regressions against MVP only (expected failure)')
    args=parser.parse_args()
    migration = '' if args.baseline else MIGRATION.read_text()
    assert not list((ROOT / 'supabase/migrations').glob('*office_chat_mvp.sql')), 'Chat must remain staged'
    name = f'prestativa-chat-test-{os.getpid()}-{time.time_ns()}'
    psql = ['docker','exec','-i',name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
            '-h','127.0.0.1','-U','postgres','-d','postgres']

    def sql(contents):
        result = subprocess.run(psql,input=contents,text=True,capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        if result.stderr:
            print(result.stderr,end='')
        return result.stdout.strip()

    started = False
    try:
        subprocess.run(['docker','run','--detach','--rm','--network','none','--name',name,
                        '-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE,'-c','wal_level=logical'],check=True,stdout=subprocess.DEVNULL)
        started = True
        for _ in range(100):
            if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('Disposable PostgreSQL readiness failed')
        sql(bootstrap())
        sql("ALTER TYPE public.app_role ADD VALUE 'superadmin';")
        sql("""
          ALTER TABLE public.profiles ADD COLUMN sprite_id text NOT NULL DEFAULT 'classic';
          CREATE PUBLICATION supabase_realtime FOR TABLE public.workspaces;
          CREATE FUNCTION public._chat_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
          BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
          CREATE FUNCTION public._chat_rejected(statement text,expected_state text,label text) RETURNS void LANGUAGE plpgsql AS $$
          DECLARE actual text;
          BEGIN BEGIN EXECUTE statement; RAISE EXCEPTION SQLSTATE 'PT001'; EXCEPTION WHEN OTHERS THEN actual:=SQLSTATE; END;
          PERFORM public._chat_assert(actual=expected_state,label); END $$;
          INSERT INTO auth.users(id,email) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fixture-'||n||'@example.test' FROM generate_series(1,4) n;
          INSERT INTO public.profiles(id,display_name,plan) SELECT id,'Fixture '||CASE right(id::text,1) WHEN '1' THEN 'A' WHEN '2' THEN 'B' ELSE 'C' END,'premium' FROM auth.users;
          INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-4000-8000-000000000003','superadmin');
          INSERT INTO public.workspaces(id,slug,name,owner_id,tier) VALUES
            ('10000000-0000-4000-8000-000000000001','chat-fixture-one','Fixture','00000000-0000-4000-8000-000000000001',3),
            ('10000000-0000-4000-8000-000000000002','chat-fixture-two','Fixture','00000000-0000-4000-8000-000000000004',3);
          INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
            ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner'),
            ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','member'),
            ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','member'),
            ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','owner');
          CREATE TEMP TABLE baseline AS SELECT
            (SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f') AS functions,
            (SELECT md5(string_agg(to_jsonb(p)::text,E'\\n' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p) AS policies;
        """)
        # Snapshot original objects outside a single connection for preservation.
        legacy = sql("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f';")
        policies = sql("SELECT md5(string_agg(to_jsonb(p)::text,E'\\n' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p;")
        if not args.baseline:
            sql('DROP PUBLICATION supabase_realtime;')
            rejected=subprocess.run(psql,input=migration,text=True,capture_output=True)
            assert rejected.returncode and 'Existing Supabase Realtime publication required' in rejected.stderr
            assert sql("SELECT to_regclass('public.chat_conversations') IS NULL AND to_regprocedure('public.chat_send_message(uuid,text,text,uuid)') IS NULL;")=='t'
            print('PASS: absent publication rolls back all new Chat objects')
            sql('CREATE PUBLICATION supabase_realtime FOR TABLE public.workspaces;')
        sql(migration)
        # Exclude only new chat functions/policies when comparing old catalog.
        assert legacy == sql("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname NOT LIKE 'chat_%';")
        assert policies == sql("SELECT md5(string_agg(to_jsonb(p)::text,E'\\n' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p WHERE tablename NOT IN('chat_conversations','chat_messages');")
        print('PASS: existing functions and policies unchanged without security stages')
        sql((TESTS/'authorization.sql').read_text())
        # Two processes concurrently create the same new pair with reversed order.
        query = "SET ROLE authenticated; SET request.jwt.claim.sub='{actor}'; SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','{peer}');"
        a,b = '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003'
        processes = []
        for actor,peer in [(a,b),(b,a)]:
            proc = subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            proc.stdin.write(query.format(actor=actor,peer=peer));proc.stdin.close();processes.append(proc)
        results=[]
        for proc in processes:
            proc.wait(timeout=15)
            if proc.returncode:
                raise RuntimeError(proc.stderr.read())
            results.append(proc.stdout.read().strip())
        assert results[0] == results[1], 'Concurrent reversed pair duplicated'
        sql("SELECT public._chat_assert((SELECT count(*)=1 FROM public.chat_conversations WHERE participant_b='00000000-0000-4000-8000-000000000003'),'concurrent reversed creation creates one row');")
        # Serialize simultaneous senders on the same conversation, preserving sequence.
        cid=results[0]
        processes=[]
        for actor in [a,b]:
            contents="SET ROLE authenticated; SET request.jwt.claim.sub='"+actor+"'; DO $$ BEGIN FOR n IN 1..10 LOOP PERFORM public.chat_send_message('"+cid+"','concurrent','text',gen_random_uuid()); END LOOP; END $$;"
            proc=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            proc.stdin.write(contents);proc.stdin.close();processes.append(proc)
        for proc in processes:
            proc.wait(timeout=15)
            if proc.returncode: raise RuntimeError(proc.stderr.read())
        sql("SELECT public._chat_assert((SELECT count(*)=20 AND count(DISTINCT seq)=20 AND min(seq)=1 AND max(seq)=20 FROM public.chat_messages WHERE conversation_id='"+cid+"'),'simultaneous senders have unique contiguous sequences');")
        sql("SELECT public._chat_assert(EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='workspaces'),'existing Realtime publication tables are preserved');")
        # Force invocation order to differ from serialization/commit order.
        # This simulates scheduler delay before locking the conversation.
        original=re.search(r"CREATE FUNCTION public.chat_lock_conversation\(.*?END \$\$;",migration,re.S).group(0)
        sql(original.replace('public.chat_lock_conversation(', 'public.chat_lock_conversation_actual(', 1))
        sql("CREATE OR REPLACE FUNCTION public.chat_lock_conversation(cid uuid) RETURNS public.chat_conversations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN IF auth.uid()='"+a+"'::uuid THEN PERFORM pg_advisory_xact_lock(991001); END IF; RETURN public.chat_lock_conversation_actual(cid); END $$;")
        blocker=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        blocker.stdin.write("DO $$ BEGIN PERFORM pg_advisory_lock(991001); END $$; SELECT 'locked'; SELECT pg_sleep(2); SELECT pg_advisory_unlock(991001);");blocker.stdin.close()
        if blocker.stdout.readline().strip()!='locked': raise RuntimeError('Clock ordering barrier failed')
        delayed=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        delayed.stdin.write("SET application_name='chat_delayed_send'; SET ROLE authenticated; SET request.jwt.claim.sub='"+a+"'; SELECT public.chat_send_message('"+cid+"','delayed','text',gen_random_uuid());");delayed.stdin.close()
        for _ in range(60):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='chat_delayed_send' AND wait_event='advisory';")=='1': break
            time.sleep(.02)
        else: raise RuntimeError('Delayed sender did not reach lock barrier')
        sql("SET ROLE authenticated; SET request.jwt.claim.sub='"+b+"'; SELECT public.chat_send_message('"+cid+"','first commit','text',gen_random_uuid());")
        blocker.wait(timeout=10);delayed.wait(timeout=10)
        if blocker.returncode or delayed.returncode: raise RuntimeError('Clock ordering fixture failed')
        sql("SELECT public._chat_assert((SELECT c.last_message_at>=(SELECT max(m.created_at) FROM public.chat_messages m WHERE m.conversation_id=c.id) FROM public.chat_conversations c WHERE c.id='"+cid+"'),'last_message_at follows serialization order, not invocation time');")
        sql(original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1));sql('DROP FUNCTION public.chat_lock_conversation_actual(uuid);')
        if args.interactions or args.interactions_baseline:
            if not args.interactions_baseline:
                incremental = (ROOT/'supabase/staged-migrations/20261015140000_office_chat_interactions.sql').read_text()
                mirror = (ROOT/'supabase/staged-migrations/drizzle/0004_office_chat_interactions.sql').read_text()
                assert incremental.replace('BEGIN;\n','',1).removesuffix('COMMIT;\n').rstrip() == mirror.rstrip()
                assert not (ROOT/'drizzle/migrations/0004_office_chat_interactions.sql').exists()
                sql(incremental)
            sql((TESTS/'interactions.sql').read_text())
            assert legacy == sql("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname NOT LIKE 'chat_%';")
            assert policies == sql("SELECT md5(string_agg(to_jsonb(p)::text,E'\\n' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p WHERE tablename NOT IN('chat_conversations','chat_messages','chat_message_reactions');")
            # Deterministic read/cancel ordering: uncommitted read holds the shared row lock.
            actor_a='00000000-0000-4000-8000-000000000001'
            actor_b='00000000-0000-4000-8000-000000000002'
            actor_c='00000000-0000-4000-8000-000000000003'
            def auth(actor):
                return "SET ROLE authenticated; SET request.jwt.claim.sub='"+actor+"'; "
            cid_ab=sql(auth(actor_a)+"SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','"+actor_b+"');")
            row=json.loads(sql(auth(actor_a)+"SELECT public.chat_send_message('"+cid_ab+"','read race','text',gen_random_uuid());"))
            holder=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            holder.stdin.write("BEGIN; "+auth(actor_b)+"DO $$ BEGIN PERFORM public.chat_mark_read('"+cid_ab+"',"+str(row['seq'])+"); END $$; SELECT 'read_locked'; SELECT pg_sleep(1); COMMIT;")
            holder.stdin.close()
            assert holder.stdout.readline().strip()=='read_locked'
            sql(auth(actor_a)+"SELECT public._chat_rejected($q$SELECT public.chat_cancel_message('"+cid_ab+"','"+row['id']+"')$q$,'PCH01','concurrent committed read atomically prevents cancellation');")
            holder.wait(timeout=10)
            assert holder.returncode==0,holder.stderr.read()
            sql("SELECT public._chat_assert((SELECT body='read race' AND cancelled_at IS NULL FROM public.chat_messages WHERE id='"+row['id']+"'),'read-winning race preserves message content');")
            # Both opposite directions must take the same ordered conversation locks.
            cid_ac=sql(auth(actor_a)+"SELECT public.chat_start_conversation('10000000-0000-4000-8000-000000000001','"+actor_c+"');")
            row_ab=json.loads(sql(auth(actor_a)+"SELECT public.chat_send_message('"+cid_ab+"','forward race AB','text',gen_random_uuid());"))
            row_ac=json.loads(sql(auth(actor_a)+"SELECT public.chat_send_message('"+cid_ac+"','forward race AC','text',gen_random_uuid());"))
            forwards=[]
            for conversation,message,peer in [(cid_ab,row_ab['id'],actor_c),(cid_ac,row_ac['id'],actor_b)]:
                proc=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                proc.stdin.write(auth(actor_a)+"SELECT public.chat_forward_message('"+conversation+"','"+message+"','"+peer+"',gen_random_uuid());")
                proc.stdin.close();forwards.append(proc)
            for proc in forwards:
                proc.wait(timeout=10)
                assert proc.returncode==0,proc.stderr.read()
            print('PASS: opposite concurrent forwards do not deadlock')
            print('PASS: incremental interactions preserve all non-Chat functions and policies')
        print('PASS: isolated Chat SQL suite')
    finally:
        if started:
            subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    run()
