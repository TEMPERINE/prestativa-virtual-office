import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AuthorizationContext = { supabase: SupabaseClient<Database>; userId: string };

/** Session identity comes from requireSupabaseAuth, never request data. */
export async function requireSuperadmin(context: AuthorizationContext): Promise<void> {
  if (!context.userId) throw new Error("forbidden");
  const { data, error } = await context.supabase.rpc("platform_is_superadmin");
  if (error || data !== true) throw new Error("forbidden");
}
