-- Phase 1: additive only; commit this enum change before phase 2.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superadmin';
