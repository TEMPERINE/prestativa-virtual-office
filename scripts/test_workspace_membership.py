"""Run real RLS/RPC regression tests in a disposable PostgreSQL container only.

No connection string, production credentials, published port, or remote DB option.
Public schema fixtures load the relevant ORIGINAL migration SQL; auth.uid() uses
the request claim setting that Supabase would populate. This is not an Auth/API test.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
TESTS = ROOT / "supabase/tests/workspace-membership"
PATCH = ROOT / "docs/drafts/workspace-membership-insert-hardening.sql"
IMAGE = "postgres:16-alpine"


def source(prefix):
    paths = list(MIGRATIONS.glob(prefix + "*.sql"))
    if len(paths) != 1:
        raise RuntimeError(f"Expected one source migration: {prefix}")
    return paths[0].read_text()


def function(sql, name):
    match = re.search(
        r"CREATE OR REPLACE FUNCTION public\." + re.escape(name) + r"\b.*?\$\$;",
        sql, re.S | re.I,
    )
    if not match:
        raise RuntimeError(f"Missing production function: {name}")
    return match.group(0)


def bootstrap():
    foundation = source("20260603221950")
    workspaces = source("20260607002245")
    invites = source("20260609001959")
    peer_privacy = source("20260609194754")
    return "\n".join([
        """
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE EXTENSION pgcrypto;
        GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
        CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        """,
        foundation.split("-- Positions")[0],
        # Current generated Supabase types include master; its enum addition is
        # absent from archived migrations. Fixture compatibility only, not a fix.
        "ALTER TYPE public.app_role ADD VALUE 'master';",
        function(foundation, "touch_updated_at"),
        workspaces.split("WITH first_user AS (")[0],
        source("20260607171213"),  # tier column and constraints
        source("20260607173829"),  # owner can read before first membership
        source("20260608083627"),  # actual plan checks/triggers
        source("20260609085259").split("-- map_overrides")[0],
        invites[invites.index("-- 2) Relax"):invites.index("-- 3) RPC")],
        function(invites, "workspace_accept_invite"),
        peer_privacy.split("-- desk_notes")[0],
        source("20261001001659").split("-- Resolução central")[0],
        source("20261001001714"),
    ])


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true",
                        help="Load old policies: the regression suite must fail")
    args = parser.parse_args()
    name = f"prestativa-membership-test-{os.getpid()}-{time.time_ns()}"

    def docker(*parts, **kwargs):
        return subprocess.run(["docker", *parts], check=True, **kwargs)

    def sql(text):
        docker("exec", "-i", name, "psql", "-X", "-q",
               "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
               input=text, text=True)

    started = False
    try:
        docker("run", "--detach", "--rm", "--network", "none", "--name", name,
               "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE,
               stdout=subprocess.DEVNULL)
        started = True
        for _ in range(100):
            ready = subprocess.run(
                ["docker", "exec", name, "pg_isready", "-U", "postgres"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready")
        sql(bootstrap())
        if not args.baseline:
            sql(PATCH.read_text())
        sql((TESTS / "assertions.sql").read_text())
        print("PASS: workspace membership PostgreSQL regression suite")
    finally:
        if started:
            subprocess.run(["docker", "rm", "-f", name],
                           stdout=subprocess.DEVNULL, check=True)


if __name__ == "__main__":
    run()
