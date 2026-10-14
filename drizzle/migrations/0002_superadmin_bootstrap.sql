DO $$ BEGIN
  PERFORM 1 FROM platform_private.transition WHERE singleton FOR UPDATE;
  IF NOT (SELECT bootstrapped FROM platform_private.transition WHERE singleton) THEN
    PERFORM public.platform_bootstrap_superadmin();
  ELSIF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.role='superadmin'
                    AND platform_private.is_superadmin(r.user_id)) THEN
    RAISE EXCEPTION 'bootstrap already ran but holder is inactive; use service recovery';
  END IF;
END $$;