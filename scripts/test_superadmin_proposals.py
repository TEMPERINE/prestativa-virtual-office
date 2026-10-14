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

PROPOSALS = ROOT / "docs/security/proposals/superadmin"
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
            "Admin updates custom_props", "Admin deletes custom_props"]],
        global_admin[global_admin.index("-- map_overrides"):],
        source("20260609085333"),
        source("20260616132723").split("-- Seed:")[0],
        source("20260609001959").split("-- 2) Relax")[0],
        function(source("20260609001959"), "signup_invite_redeem"),
        source("20260930175640"),
        rtc[rtc.index("CREATE TABLE IF NOT EXISTS public.rtc_events"):rtc.index("-- 5/6.")],
        source("20261001000457"),
        function(source("20261006203240"), "can_read_meeting_participants"),
        function(source("20261001001659"), "can_record_meeting"),
    ])


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true", help="Confirm absent Superadmin on original schema")
    args = parser.parse_args()
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

    def cutover_sql():
        return "BEGIN;\n" + (PROPOSALS / "04-membership-cutover.sql").read_text() + \
            (PROPOSALS / "05-legacy-overrides-cutover.sql").read_text() + "\nCOMMIT;"

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
        sql('CREATE POLICY "test residual global override" ON public.custom_props FOR SELECT TO authenticated USING (public.has_role(auth.uid(),\'admin\'));')
        assert_cutover_abort("unreviewed legacy global policy remains", "failure in stage 05 rolls back stage 04 policies grants and activation")
        sql('DROP POLICY "test residual global override" ON public.custom_props;')

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
            for name_part in ["01-role.sql", "02-foundation.sql", "03-administration-rpcs.sql"]:
                sql((PROPOSALS / name_part).read_text())
        sql((TESTS / "foundation.sql").read_text())
        concurrency_checks()
        cutover_failure_checks()
        sql(cutover_sql())
        sql((TESTS / "authorization.sql").read_text())
        print("PASS: review-only Superadmin proposals PostgreSQL suite")
    finally:
        if started:
            subprocess.run(["docker", "rm", "-f", name], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    run()
