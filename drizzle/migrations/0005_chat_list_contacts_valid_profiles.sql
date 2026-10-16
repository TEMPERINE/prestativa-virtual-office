CREATE OR REPLACE FUNCTION public.chat_list_contacts(ws uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.user_id,'name',btrim(p.display_name),'sprite_id',p.sprite_id)
    ORDER BY btrim(p.display_name),m.user_id),'[]'::jsonb) INTO result
    FROM public.workspace_members m JOIN public.profiles p ON p.id=m.user_id
    WHERE m.workspace_id=ws AND m.user_id<>auth.uid()
      AND p.display_name IS NOT NULL AND btrim(p.display_name)<>'';
  RETURN result;
END $function$;