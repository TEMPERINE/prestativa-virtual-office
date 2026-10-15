"""Execute REVIEW-ONLY Superadmin SQL in disposable PostgreSQL, never remotely.

Original policies/RPCs are loaded from repository migrations. Fixtures supply
only Auth/catalog/storage table shapes used by authorization tests, not real
Supabase Auth, Storage, REST, Electron or RTC services. No network or open port.
"""
import argparse
import os
import re
import subprocess
import time
from test_workspace_membership import ROOT, IMAGE, bootstrap, source, function

TESTS = ROOT / "supabase/tests/superadmin"


def policy(text, name):
    match = re.search(r'CREATE POLICY "' + re.escape(name) + r'".*?;', text, re.S)
    if not match:
        raise RuntimeError(f"Original policy not found: {name}")
    return match.group(0)


def additional_fixtures():
    ws = source("20260607002245")
    global_admin = source("20260609085259")
    rtc = source("20260928185915")
    return "\n".join([
        """
        ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz;
        ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;
        CREATE SCHEMA extensions;
        CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea
          LANGUAGE sql AS $$ SELECT public.gen_random_bytes(n) $$;
        CREATE SCHEMA storage;
        CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
        GRANT USAGE ON SCHEMA storage TO authenticated,service_role;
        GRANT ALL ON storage.objects TO authenticated,service_role;
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        CREATE TABLE public.map_overrides(workspace_id uuid PRIMARY KEY,data jsonb);
        CREATE TABLE public.custom_props(id text PRIMARY KEY,workspace_id uuid,label text);
        GRANT ALL ON public.map_overrides,public.custom_props TO authenticated,service_role;
        ALTER TABLE public.map_overrides ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.custom_props ENABLE ROW LEVEL SECURITY;
        CREATE TABLE public.meetings(id uuid PRIMARY KEY,workspace_id uuid);
        CREATE TABLE public.meeting_recording_shares(meeting_id uuid,recipient_id uuid);
        CREATE TABLE public.meeting_participants(meeting_id uuid,user_id uuid);
        GRANT ALL ON public.meetings,public.meeting_recording_shares,public.meeting_participants TO service_role;
        GRANT SELECT ON public.meeting_participants TO authenticated;
        ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
        """,
        function(source("20260606175342"), "is_meeting_participant"),
        *[policy(ws, name) for name in [
            "Members read map", "Workspace admin upserts map", "Workspace admin updates map",
            "Workspace admin deletes map", "Admin inserts custom_props",
            "Admin updates custom_props", "Admin deletes custom_props", "Members read custom_props"]],
        global_admin[global_admin.index("-- map_overrides"):],
        source("20260609085333"),
        source("20260616132723").split("-- Seed:")[0],
        source("20260930175640"),
        rtc[rtc.index("CREATE TABLE IF NOT EXISTS public.rtc_events"):rtc.index("-- 5/6.")],
        source("20261001000457"),
        function(source("20261006203240"), "can_read_meeting_participants"),
        function(source("20261001001659"), "can_record_meeting"),
    ])


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--migrations", action="store_true", default=True, help="Compatibility flag: the canonical staged suite is now the default")
    parser.add_argument("--helpers-red", action="store_true", help="Run helper privacy regression against old functions")
    parser.add_argument("--baseline", action="store_true", help="Confirm absent Superadmin on original schema")
    args = parser.parse_args()
    if args.migrations:
        names = ["superadmin_role", "superadmin_foundation_and_rpcs", "superadmin_bootstrap",
                 "workspace_membership_hardening", "authorization_helpers_and_recording",
                 "retire_legacy_global_overrides", "foundation_reconciliation"]
        for suffix in names:
            if list((ROOT / "supabase/migrations").glob("*" + suffix + ".sql")):
                raise RuntimeError("Security migration must be outside automatic discovery: " + suffix)
            if len(list((ROOT / "supabase/staged-migrations").glob("*" + suffix + ".sql"))) != 1:
                raise RuntimeError("Expected exactly one staged security migration: " + suffix)
    name = f"prestativa-superadmin-test-{os.getpid()}-{time.time_ns()}"

    def docker(*parts, **kwargs):
        return subprocess.run(["docker", *parts], check=True, **kwargs)

    psql = ["docker", "exec", "-i", name, "psql", "-X", "-q", "-A", "-t",
            "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
            "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres"]

    def sql(contents):
        docker("exec", "-i", name, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
               "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", input=contents, text=True)

    def scalar(contents):
        return subprocess.run(psql, input=contents, text=True, capture_output=True, check=True).stdout.strip()

    def concurrent_session(label, contents):
        proc = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        proc.stdin.write(f"SET application_name='{label}';\n" + contents)
        proc.stdin.close()
        return proc

    def concurrency_checks():
        # Inactive-target regression: force recovery to wait on an Auth UPDATE.
        blocker = concurrent_session("test_superadmin_ban", """
          BEGIN;
          UPDATE auth.users SET banned_until=now()+interval '1 day'
            WHERE id='00000000-0000-4000-8000-000000000007';
          SELECT 'locked';
          SELECT pg_sleep(2);
          COMMIT;
        """)
        try:
            if blocker.stdout.readline().strip() != "locked":
                raise RuntimeError("Inactive-account test barrier failed")
            recovering = concurrent_session("test_superadmin_recover", """
              SET ROLE service_role;
              SELECT public.platform_recover_superadmin('00000000-0000-4000-8000-000000000007');
            """)
            try:
                for _ in range(40):
                    waiting = scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='test_superadmin_recover' AND wait_event_type='Lock';")
                    if waiting == "1":
                        break
                    time.sleep(0.025)
                else:
                    raise RuntimeError("Recovery did not wait on the concurrent account update")
                recovering.wait(timeout=10)
                error = recovering.stderr.read()
                if recovering.returncode == 0 or "23514" not in error:
                    raise RuntimeError("Recovery failed to reject concurrently disabled account")
            finally:
                if recovering.poll() is None:
                    recovering.kill()
                    recovering.wait()
            blocker.wait(timeout=10)
            if blocker.returncode:
                raise RuntimeError("Concurrent account update failed")
        finally:
            if blocker.poll() is None:
                blocker.kill()
                blocker.wait()
        sql("""
          SELECT public._test_assert(platform_private.is_superadmin('00000000-0000-4000-8000-000000000001'),
            'concurrent account disabling cannot replace active superadmin');
          UPDATE auth.users SET banned_until=NULL WHERE id='00000000-0000-4000-8000-000000000007';
        """)
        # The readiness gate must hold its singleton lock until full cutover
        # transaction ends. Recovery is rolled back so fixtures stay unchanged.
        gate = concurrent_session("test_superadmin_cutover", """
          BEGIN;
          SELECT platform_private.require_cutover_ready();
          SELECT 'locked';
          SELECT pg_sleep(2);
          COMMIT;
        """)
        try:
            # void-return SELECT prints an empty line; the next row is barrier.
            if gate.stdout.readline().strip() != "" or gate.stdout.readline().strip() != "locked":
                raise RuntimeError("Cutover lock test barrier failed")
            recovery = concurrent_session("test_superadmin_recovery_wait", """
              BEGIN;
              SET LOCAL ROLE service_role;
              SELECT public.platform_recover_superadmin('00000000-0000-4000-8000-000000000007');
              ROLLBACK;
            """)
            try:
                for _ in range(40):
                    waiting = scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='test_superadmin_recovery_wait' AND wait_event_type='Lock';")
                    if waiting == "1":
                        break
                    time.sleep(0.025)
                else:
                    raise RuntimeError("Recovery bypassed the readiness transaction lock")
                recovery.wait(timeout=10)
                if recovery.returncode:
                    raise RuntimeError("Recovery did not resume after cutover lock release")
            finally:
                if recovery.poll() is None:
                    recovery.kill()
                    recovery.wait()
            gate.wait(timeout=10)
            if gate.returncode:
                raise RuntimeError("Cutover lock transaction failed")
        finally:
            if gate.poll() is None:
                gate.kill()
                gate.wait()
        sql("SELECT public._test_assert(true,'cutover readiness lock serializes recovery until transaction ends');")

    def staged(suffix):
        paths=list((ROOT / "supabase/staged-migrations").glob("*"+suffix+".sql"))
        if len(paths)!=1: raise RuntimeError("Expected one staged migration: "+suffix)
        return paths[0].read_text()

    def cutover_sql():
        return staged("workspace_membership_hardening")

    def assert_cutover_abort(expected_message, label):
        result = subprocess.run(psql, input=cutover_sql(), text=True, capture_output=True)
        if result.returncode == 0 or expected_message not in result.stderr:
            raise RuntimeError(f"Incorrect cutover failure: {label}")
        # The connection closes with an uncommitted transaction: actual rollback
        # must restore policies, grants AND the activation flag, even after 04.
        sql("SELECT public._test_assert(" +
            "NOT (SELECT membership_hardened FROM platform_private.transition WHERE singleton) " +
            "AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.workspace_members'::regclass " +
            "AND polname='Admin or self inserts member') " +
            "AND has_table_privilege('authenticated','public.workspace_members','UPDATE'), " +
            f"'{label}');")

    def cutover_failure_checks():
        sql('CREATE POLICY "test unexpected write" ON public.workspace_members FOR INSERT TO authenticated WITH CHECK (false);')
        assert_cutover_abort("unexpected membership write policy", "unexpected membership policy aborts cutover")
        sql('DROP POLICY "test unexpected write" ON public.workspace_members;')
        sql("UPDATE public.workspace_members SET role='owner' WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000004';")
        assert_cutover_abort("noncanonical owner membership", "noncanonical owner aborts cutover")
        sql("UPDATE public.workspace_members SET role='member' WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000004';")
        sql("DELETE FROM public.workspace_members WHERE workspace_id='10000000-0000-4000-8000-000000000001' AND user_id='00000000-0000-4000-8000-000000000002';")
        assert_cutover_abort("workspace missing canonical owner membership", "missing canonical owner membership aborts cutover")
        sql("INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','owner');")
        sql("INSERT INTO public.workspace_invites(workspace_id,email,token,role,invited_by) VALUES('10000000-0000-4000-8000-000000000001',NULL,'pending-test','admin','00000000-0000-4000-8000-000000000002');")
        assert_cutover_abort("pending privileged invites", "pending privileged invite aborts cutover")
        sql("DELETE FROM public.workspace_invites WHERE token='pending-test';")
    def function_cutover_failure_checks():
        previous_read_helper = scalar("SELECT md5(pg_get_functiondef('public.can_read_meeting_participants(uuid,uuid)'::regprocedure));")
        def rejects(label):
            result = subprocess.run(psql, input=staged("retire_legacy_global_overrides"), text=True, capture_output=True)
            if result.returncode == 0 or "unreviewed legacy authorization function remains" not in result.stderr:
                raise RuntimeError("Function inventory gate did not fail closed: " + label)
            sql("SELECT public._test_assert(NOT (SELECT retired FROM platform_private.transition WHERE singleton) "
                "AND EXISTS (SELECT 1 FROM pg_policy WHERE polname='Admin can manage custom_props') "
                "AND md5(pg_get_functiondef('public.can_read_meeting_participants(uuid,uuid)'::regprocedure))='" + previous_read_helper + "', '" + label + "');")

        fixtures = [
            ("public.test_legacy_admin()", "LANGUAGE sql AS $$ SELECT public.has_role(auth.uid(),'admin') $$", "admin helper aborts and rolls back final retirement"),
            ("public.test_legacy_master()", "LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='master') $$", "direct master role lookup aborts final retirement"),
            ("platform_private.test_legacy_hidden()", "LANGUAGE sql AS $$ SELECT public.has_role(auth.uid(),'admin') $$", "private schema does not conceal legacy authorization"),
            ("public.can_record_meeting(text,text)", "LANGUAGE sql AS $$ SELECT public.has_role(auth.uid(),'admin') $$", "same-name overload is not allowlisted"),
        ]
        for signature, definition, label in fixtures:
            sql("CREATE FUNCTION " + signature + " RETURNS boolean " + definition + ";")
            if signature.startswith("platform_private."):
                sql("REVOKE EXECUTE ON FUNCTION " + signature + " FROM PUBLIC;")
            rejects(label)
            sql("DROP FUNCTION " + signature + ";")

        sql("CREATE SCHEMA test_legacy_review; "
            "CREATE FUNCTION test_legacy_review.check_access() RETURNS boolean LANGUAGE sql "
            "AS $fixture$ SELECT public.has_role(auth.uid(),$legacy$master$legacy$::public.app_role) $fixture$;")
        rejects("custom schema and dollar-quoted legacy roles cannot bypass inventory")
        sql("DROP FUNCTION test_legacy_review.check_access(); DROP SCHEMA test_legacy_review;")
        sql("CREATE PROCEDURE public.test_legacy_procedure() LANGUAGE plpgsql "
            "AS $$ BEGIN PERFORM public.has_role(auth.uid(),'admin'); END $$;")
        rejects("procedure authorization is inventoried without inspecting aggregates")
        sql("DROP PROCEDURE public.test_legacy_procedure();")

        original = scalar("SELECT pg_get_functiondef('public.can_record_meeting(uuid,uuid)'::regprocedure);")
        sql("CREATE OR REPLACE FUNCTION public.can_record_meeting(_user_id uuid,_workspace_id uuid) "
            "RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog "
            "AS $$ SELECT public.has_role(_user_id,'admin') $$;")
        rejects("changed allowlisted body does not inherit the exception")
        sql(original)
        sql("CREATE OR REPLACE FUNCTION public.can_record_meeting(_user_id uuid,_workspace_id uuid) "
            "RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT true $$;")
        rejects("allowlisted routine drift is caught even after role literals are removed")
        sql(original)
        sql("GRANT EXECUTE ON FUNCTION public.platform_recover_superadmin(uuid) TO authenticated;")
        rejects("unsafe grants on allowlisted lifecycle function abort retirement")
        sql("REVOKE EXECUTE ON FUNCTION public.platform_recover_superadmin(uuid) FROM authenticated;")

    def private_acl_failure_checks():
        signatures = [
            "platform_private.is_superadmin(uuid)",
            "platform_private.has_role(uuid,public.app_role)",
            "platform_private.is_workspace_member(uuid,uuid)",
            "platform_private.is_workspace_admin(uuid,uuid)",
            "platform_private.check_capacity(uuid,uuid)",
            "platform_private.is_service_context()",
        ]
        original = scalar("SELECT md5(pg_get_functiondef('public.can_read_meeting_participants(uuid,uuid)'::regprocedure));")
        for signature in signatures:
            for role in ["PUBLIC", "anon", "authenticated", "service_role"]:
                sql("GRANT EXECUTE ON FUNCTION " + signature + " TO " + role + ";")
                result = subprocess.run(psql, input=staged("retire_legacy_global_overrides"), text=True, capture_output=True)
                if result.returncode == 0 or "unexpected private EXECUTE" not in result.stderr:
                    raise RuntimeError("Private ACL gate did not fail closed: " + signature + " / " + role)
                sql("SELECT public._test_assert(NOT (SELECT retired FROM platform_private.transition WHERE singleton) "
                    "AND EXISTS(SELECT 1 FROM pg_policy WHERE polname='Admin can manage custom_props') "
                    "AND md5(pg_get_functiondef('public.can_read_meeting_participants(uuid,uuid)'::regprocedure))='" + original +
                    "','private ACL drift aborts with rollback: " + signature + " / " + role + "');")
                sql("REVOKE EXECUTE ON FUNCTION " + signature + " FROM " + role + ";")
        # Future private routines are inventoried without names or role literals.
        sql("CREATE FUNCTION platform_private.test_new_helper() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;")
        result = subprocess.run(psql, input=staged("retire_legacy_global_overrides"), text=True, capture_output=True)
        if result.returncode == 0 or "unexpected private EXECUTE" not in result.stderr:
            raise RuntimeError("New private helper escaped ACL inventory")
        sql("DROP FUNCTION platform_private.test_new_helper(); SELECT public._test_assert(true,'future private helper default PUBLIC grant is caught');")

    started = False
    try:
        docker("run", "--detach", "--rm", "--network", "none", "--name", name,
               "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE, stdout=subprocess.DEVNULL)
        started = True
        for _ in range(100):
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready")
        sql(bootstrap())
        sql(additional_fixtures())
        sql((TESTS / "fixtures.sql").read_text())
        if not args.baseline:
            if args.migrations:
                for suffix in ["superadmin_role","superadmin_foundation_and_rpcs"]:
                    sql(staged(suffix))
                # Foundation rerun must not reset singleton, assignments or grants.
                sql(staged("superadmin_foundation_and_rpcs"))
        if args.helpers_red:
            sql((TESTS / "helpers.sql").read_text())
            return
        sql((TESTS / "foundation.sql").read_text())
        concurrency_checks()
        cutover_failure_checks()
        sql(cutover_sql())
        if args.migrations:
            sql(cutover_sql())
            sql(staged("authorization_helpers_and_recording"))
            sql(staged("authorization_helpers_and_recording"))
            sql((TESTS / "helpers.sql").read_text())
            sql((TESTS / "constraints.sql").read_text())
            sql((TESTS / "atomic-administration.sql").read_text())
            # Both bootstrap migration and already hardened stages are idempotent.
            sql(staged("superadmin_bootstrap"))
            sql(staged("superadmin_bootstrap"))
            sql('CREATE POLICY "test residual global override" ON public.custom_props FOR SELECT TO authenticated USING (public.has_role(auth.uid(),\'admin\'));')
            result=subprocess.run(psql,input=staged("retire_legacy_global_overrides"),text=True,capture_output=True)
            if result.returncode==0 or "unreviewed legacy global policy remains" not in result.stderr:
                raise RuntimeError("Final retirement did not fail closed: " + result.stderr)
            sql("SELECT public._test_assert(NOT (SELECT retired FROM platform_private.transition WHERE singleton) AND EXISTS (SELECT 1 FROM pg_policy WHERE polname='Admin can manage custom_props'),'failed final retirement rolls back all global policy removal');")
            sql('DROP POLICY "test residual global override" ON public.custom_props;')
            private_acl_failure_checks()
            function_cutover_failure_checks()
            sql(staged("retire_legacy_global_overrides"))
            sql(staged("retire_legacy_global_overrides"))
            sql((TESTS / "local-policies.sql").read_text())
            sql((TESTS / "helpers.sql").read_text())
        sql((TESTS / "authorization.sql").read_text())
        print("PASS: canonical staged Superadmin PostgreSQL suite")
    finally:
        if started:
            subprocess.run(["docker", "rm", "-f", name], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    run()
