CREATE FUNCTION public.workspace_runtime_profiles(workspace_id uuid)
RETURNS TABLE(id uuid, display_name text, sprite_id text, avatar_color text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.can_access_workspace_runtime(workspace_id, auth.uid()), false) THEN
    RAISE EXCEPTION 'Workspace runtime unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.sprite_id, p.avatar_color
    FROM public.workspace_members AS m
    JOIN public.profiles AS p ON p.id = m.user_id
    WHERE m.workspace_id = $1
    ORDER BY p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_runtime_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_runtime_profiles(uuid) TO authenticated;
COMMENT ON FUNCTION public.workspace_runtime_profiles(uuid) IS 'Authorized workspace member display identities only; no personal profile fields and no visitor memberships.';