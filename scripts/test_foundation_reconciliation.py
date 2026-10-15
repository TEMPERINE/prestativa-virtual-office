"""Reproduce applied Lovable history only in network-isolated disposable PostgreSQL.
No remote connection option, credentials or published ports. No production SQL.
"""
import hashlib
import os
import re
import subprocess
import time
from test_workspace_membership import ROOT, IMAGE, bootstrap
from test_superadmin_proposals import additional_fixtures, TESTS

STAGED = ROOT / 'supabase/staged-migrations'
HISTORY = ROOT / 'drizzle/migrations'
TARGETS = [
    ('public.platform_recover_superadmin(uuid)', 'platform_recover_superadmin'),
    ('platform_private.require_cutover_ready()', 'require_cutover_ready'),
    ('public.platform_transfer_workspace_owner(uuid,uuid,public.workspace_role)', 'platform_transfer_workspace_owner'),
    ('public.platform_create_workspace_invite(uuid,text,interval)', 'platform_create_workspace_invite'),
]
HELPERS = ['platform_private.is_superadmin(uuid)', 'platform_private.has_role(uuid,public.app_role)',
           'platform_private.is_workspace_member(uuid,uuid)', 'platform_private.is_workspace_admin(uuid,uuid)']


def definitions(contents):
    return {m.group(1): m.group(0) for m in re.finditer(
        r'CREATE OR REPLACE FUNCTION ((?:public|platform_private)\.\w+)\(.*?\$\$;', contents, re.S)}


def run():
    reconciliation = (STAGED / '20261014120230_foundation_reconciliation.sql').read_text()
    if list((ROOT / 'supabase/migrations').glob('*foundation_reconciliation.sql')):
        raise RuntimeError('Reconciliation must remain staged')
    approved = definitions((STAGED / '20261014120100_superadmin_foundation_and_rpcs.sql').read_text())
    history = definitions((HISTORY / '0001_superadmin_foundation_and_rpcs.sql').read_text())
    name = f'prestativa-reconciliation-test-{os.getpid()}-{time.time_ns()}'
    psql = ['docker', 'exec', '-i', name, 'psql', '-X', '-q', '-A', '-t',
            '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres']

    def sql(contents):
        result = subprocess.run(psql, input=contents, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        if result.stderr:
            print(result.stderr, end='')
        return result.stdout.strip()

    def rejects(contents, message, label):
        result = subprocess.run(psql, input=contents, text=True, capture_output=True)
        if result.returncode == 0 or message not in result.stderr:
            raise RuntimeError(f'Expected fail-closed: {label}: {result.stderr}')
        print('PASS: ' + label)

    started = False
    try:
        subprocess.run(['docker', 'run', '--detach', '--rm', '--network', 'none', '--name', name,
                        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE], check=True, stdout=subprocess.DEVNULL)
        started = True
        for _ in range(100):
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('PostgreSQL readiness failed')
        sql(bootstrap())
        sql(additional_fixtures())
        sql((TESTS / 'fixtures.sql').read_text())
        # Shape the synthetic dataset like the operator-confirmed baseline.
        sql("DELETE FROM public.workspaces WHERE id='10000000-0000-4000-8000-000000000002'; UPDATE public.workspace_members SET role='member' WHERE role='admin';")
        sql("INSERT INTO auth.users(id,email) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fixture-'||n||'@example.test' FROM generate_series(5,19) n ON CONFLICT DO NOTHING;")
        sql("INSERT INTO public.workspace_members(workspace_id,user_id,role) SELECT '10000000-0000-4000-8000-000000000001',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'member' FROM generate_series(5,19) n;")
        for filename in ['0000_superadmin_role.sql' , '0001_superadmin_foundation_and_rpcs.sql', '0002_superadmin_bootstrap.sql']:
            sql((HISTORY / filename).read_text())
        for signature in HELPERS:
            sql(f"SELECT public._test_assert(has_function_privilege('authenticated','{signature}','EXECUTE') AND NOT has_schema_privilege('authenticated','platform_private','USAGE'),'historical EXECUTE is inherited although schema remains private');")
        for signature, _ in TARGETS:
            expected = hashlib.md5(approved[signature.split('(')[0]].split('$$')[1].encode()).hexdigest()
            sql(f"SELECT public._test_assert(md5((SELECT prosrc FROM pg_proc WHERE oid='{signature}'::regprocedure))<>'{expected}','historical comment transformation reproduced');")
        before_query = (ROOT / 'docs/security/operations/foundation-reconciliation/before.sql').read_text().strip().rstrip(';')
        sql("WITH result AS (" + before_query + ") SELECT public._test_assert(validacao_ok AND rotinas_com_execute_cliente=4 AND contratos_conhecidos_ok=25,'operator preflight accepts only documented executor drift') FROM result;")
        # Snapshot data, policies, old routines, function identities and public ACLs.
        sql('CREATE TABLE public._reconciliation_baseline(kind text PRIMARY KEY, value jsonb);')
        for table in ['auth.users', 'public.user_roles', 'public.profiles', 'public.workspaces',
                      'public.workspace_members', 'public.workspace_invites', 'platform_private.transition', 'platform_private.admin_audit']:
            sql(f"INSERT INTO public._reconciliation_baseline SELECT '{table}', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM {table} t;")
        sql("INSERT INTO public._reconciliation_baseline SELECT 'policies',jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p;")
        sql("INSERT INTO public._reconciliation_baseline SELECT 'legacy',jsonb_agg(jsonb_build_array(oid,prosrc,proacl) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('is_workspace_admin','is_workspace_member','has_role','current_user_email','workspace_accept_invite','can_record_meeting','workspace_members_guard_profile');")
        for signature, _ in TARGETS:
            sql(f"INSERT INTO public._reconciliation_baseline SELECT '{signature}',jsonb_build_array(oid,proacl) FROM pg_proc WHERE oid='{signature}'::regprocedure;")
        rejects('SET ROLE authenticated;\n' + reconciliation, 'trusted postgres', 'client cannot run reconciliation')
        # Known function with unknown body must abort without partial ACL change.
        sig, function_name = TARGETS[0]
        original = history['public.' + function_name]
        sql(original.replace('$$;', '\n-- unreviewed drift\n$$;'))
        rejects(reconciliation, 'unreviewed foundation function', 'unknown body aborts before overwriting')
        sql(f"SELECT public._test_assert(has_function_privilege('authenticated','{HELPERS[0]}','EXECUTE'),'failed reconciliation preserves original ACLs atomically');")
        sql(original)
        for variant, mapping in [('executor', history), ('canonical', approved)]:
            definition = mapping['public.platform_transfer_workspace_owner']
            sql(definition.replace("DEFAULT 'member'", "DEFAULT 'admin'"))
            sql("WITH result AS (" + before_query + ") SELECT public._test_assert(NOT validacao_ok AND contratos_conhecidos_ok=24,'preflight detects changed default despite known body') FROM result;")
            rejects(reconciliation, 'unreviewed foundation function', variant + ' body with altered default is rejected')
            sql(history['public.platform_transfer_workspace_owner'])
            sql(definition.replace('LANGUAGE plpgsql SECURITY DEFINER', 'LANGUAGE plpgsql STRICT SECURITY DEFINER'))
            sql("WITH result AS (" + before_query + ") SELECT public._test_assert(NOT validacao_ok AND contratos_conhecidos_ok=24,'preflight detects STRICT drift despite known body') FROM result;")
            rejects(reconciliation, 'unreviewed foundation function', variant + ' body with STRICT drift is rejected')
            sql(history['public.platform_transfer_workspace_owner'])
        sql('UPDATE platform_private.transition SET membership_hardened=true WHERE singleton;')
        rejects(reconciliation, 'post-bootstrap before phase 4', 'wrong rollout phase aborts')
        sql('UPDATE platform_private.transition SET membership_hardened=false WHERE singleton;')
        sql("GRANT EXECUTE ON FUNCTION platform_private.check_capacity(uuid,uuid) TO authenticated;")
        rejects(reconciliation, 'unexpected private EXECUTE', 'unknown private ACL drift is not silently rewritten')
        for signature, _ in TARGETS:
            expected = hashlib.md5(history[signature.split('(')[0]].split('$$')[1].encode()).hexdigest()
            sql(f"SELECT public._test_assert((SELECT md5(prosrc)='{expected}' FROM pg_proc WHERE oid='{signature}'::regprocedure),'late reconciliation failure rolls back each body restoration');")
        sql("REVOKE EXECUTE ON FUNCTION platform_private.check_capacity(uuid,uuid) FROM authenticated;")
        sql(reconciliation)
        sql(reconciliation)
        after_query = (ROOT / 'docs/security/operations/foundation-reconciliation/after.sql').read_text().strip().rstrip(';')
        sql("WITH result AS (" + after_query + ") SELECT public._test_assert(validacao_ok AND rotinas_com_execute_cliente=0 AND contratos_ok=25,'operator postflight proves all canonical contracts and private ACLs') FROM result;")
        for alteration, label in [("DEFAULT 'admin'", 'default'), ("STRICT", 'STRICT')]:
            definition = approved['public.platform_transfer_workspace_owner']
            altered = definition.replace("DEFAULT 'member'", alteration) if label == 'default' else definition.replace('LANGUAGE plpgsql SECURITY DEFINER', 'LANGUAGE plpgsql STRICT SECURITY DEFINER')
            sql(altered)
            sql("WITH result AS (" + after_query + ") SELECT public._test_assert(NOT validacao_ok AND contratos_ok=24,'postflight rejects " + label + " drift with canonical body and closed ACLs') FROM result;")
            rejects(reconciliation, 'unreviewed foundation function', 'canonical post-reconciliation ' + label + ' drift is rejected')
            sql(definition)
        for signature in HELPERS:
            for role in ['anon', 'authenticated', 'service_role']:
                sql(f"SELECT public._test_assert(NOT has_function_privilege('{role}','{signature}','EXECUTE'),'reconciled private helper denies {role} EXECUTE');")
        sql("SELECT public._test_assert(NOT EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='platform_private'::regnamespace AND a.grantee=0 AND a.privilege_type='EXECUTE'),'all private helpers deny PUBLIC');")
        for role in ['anon', 'authenticated', 'service_role']:
            sql(f"SELECT public._test_assert(NOT has_schema_privilege('{role}','platform_private','USAGE'),'private schema denies {role} USAGE');")
        for table in ['auth.users', 'public.user_roles', 'public.profiles', 'public.workspaces', 'public.workspace_members',
                      'public.workspace_invites', 'platform_private.transition', 'platform_private.admin_audit']:
            sql(f"SELECT public._test_assert((SELECT value FROM public._reconciliation_baseline WHERE kind='{table}')=(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM {table} t),'reconciliation and rerun preserve {table}');")
        sql("SELECT public._test_assert((SELECT value FROM public._reconciliation_baseline WHERE kind='policies')=(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p),'all policies preserved');")
        sql("SELECT public._test_assert((SELECT value FROM public._reconciliation_baseline WHERE kind='legacy')=(SELECT jsonb_agg(jsonb_build_array(oid,prosrc,proacl) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('is_workspace_admin','is_workspace_member','has_role','current_user_email','workspace_accept_invite','can_record_meeting','workspace_members_guard_profile')),'legacy functions and grants preserved');")
        for signature, _ in TARGETS:
            expected = hashlib.md5(approved[signature.split('(')[0]].split('$$')[1].encode()).hexdigest()
            sql(f"SELECT public._test_assert((SELECT md5(prosrc)='{expected}' AND jsonb_build_array(oid,proacl)=(SELECT value FROM public._reconciliation_baseline WHERE kind='{signature}') FROM pg_proc WHERE oid='{signature}'::regprocedure),'approved body restored without changing OID or public grants');")
        sql("SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; SELECT public._test_assert(public.platform_is_superadmin(),'bootstrapped account keeps Superadmin access'); SELECT public.platform_acknowledge_superadmin_access(); RESET ROLE;")
        sql("SET ROLE service_role; SELECT public.platform_authorize_cutover('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); RESET ROLE;")
        for suffix in ['workspace_membership_hardening', 'authorization_helpers_and_recording', 'retire_legacy_global_overrides']:
            sql(next(STAGED.glob('*' + suffix + '.sql')).read_text())
        sql("SELECT public._test_assert((SELECT retired FROM platform_private.transition WHERE singleton),'Lovable history plus reconciliation passes strict future gate');")
        print('PASS: disposable Lovable foundation reconciliation suite')
    finally:
        if started:
            subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    run()
