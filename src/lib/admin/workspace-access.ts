/** Chooses transport only. Every privileged server handler rechecks the role. */
export async function usesSuperadminTransport(): Promise<boolean> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.rpc("platform_is_superadmin");
  if (error) throw new Error("Não foi possível verificar a autorização administrativa.");
  return data === true;
}
