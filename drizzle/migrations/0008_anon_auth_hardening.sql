-- 1) workspace_members: auto-inserção só como owner do próprio workspace; elevação protegida.
DROP POLICY IF EXISTS "Admin or self inserts member" ON public.workspace_members;
CREATE POLICY "Owner self or admin inserts member" ON public.workspace_members
FOR INSERT TO authenticated WITH CHECK (
  (
    user_id = auth.uid() AND role = 'owner'
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
  )
  OR (
    user_id <> auth.uid()
    AND public.is_workspace_admin(workspace_id, auth.uid())
    AND (
      role = 'member'
      OR (role = 'admin' AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Admin updates members" ON public.workspace_members;
CREATE POLICY "Admin updates members" ON public.workspace_members
FOR UPDATE TO authenticated
USING (
  public.is_workspace_admin(workspace_id, auth.uid())
  AND role <> 'owner'
  AND user_id <> auth.uid()
)
WITH CHECK (
  public.is_workspace_admin(workspace_id, auth.uid())
  AND user_id <> auth.uid()
  AND (
    role = 'member'
    OR (role = 'admin' AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
  )
);

-- 3) account_groups: somente admins globais (policy "Admins manage groups" já cobre SELECT).
DROP POLICY IF EXISTS "Authenticated can read groups" ON public.account_groups;

-- 5) profiles: contas anônimas (visitantes) não criam/alteram perfil de funcionário.
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
WITH CHECK (auth.uid() = id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);