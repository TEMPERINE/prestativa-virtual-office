-- Review-only psql wrapper, NOT a Supabase migration or a production command.
-- SQL Editor: paste 04 + 05 between BEGIN/COMMIT in this order after approval.
\set ON_ERROR_STOP on
BEGIN;
\ir 04-membership-cutover.sql
\ir 05-legacy-overrides-cutover.sql
COMMIT;
