// Server functions de gestão de contas — somente Superadmin global explícito.
//
// Centraliza:
//  - createAccount: cria usuário no auth + define plano + (opcional) adiciona a um espaço
//  - listAccounts: lista todos os perfis com plano, role, contagem de espaços
//  - setAccountPlan: troca o plano de uma conta
//  - resetAccountPassword: redefine senha
//  - deleteAccount: remove conta completamente

import { createServerFn } from "@tanstack/react-start";
import { requireSuperadmin } from "@/lib/admin/permissions.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { normalizeMemberProfile, type MemberProfile } from "@/lib/meetings/record-permission";

type Plan = "essencial" | "pro" | "premium";

/** Replaces direct privileged signup_invites INSERT after legacy retirement. */
export const adminCreateSignupInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { plan: Plan; tier: 1 | 2 | 3; email?: string | null; workspaceName?: string | null }) => {
    if (!["essencial", "pro", "premium"].includes(input.plan) || ![1, 2, 3].includes(input.tier)) {
      throw new Error("Plano ou nível inválido.");
    }
    if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Email inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invite, error } = await supabaseAdmin.from("signup_invites").insert({
      plan: data.plan, tier: data.tier, email: data.email?.trim() || null,
      workspace_name_suggestion: data.workspaceName?.trim() || null,
      created_by: context.userId,
    }).select("id, token, expires_at").single();
    if (error) throw new Error("Não foi possível criar o convite de cadastro.");
    return { invite };
  });


export const adminListAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: users, error: usersErr } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (usersErr) throw new Error(usersErr.message);

    const ids = users.users.map((u) => u.id);
    const [{ data: profiles }, { data: roles }, { data: members }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, plan, group_id").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin
        .from("workspace_members")
        .select("user_id, workspace_id, role, member_profile, workspaces:workspace_id(name)")
        .in("user_id", ids),
    ]);

    const byId = new Map(
      users.users.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      })).map((u) => [u.id, u as any]),
    );
    (profiles ?? []).forEach((p: any) => {
      const row = byId.get(p.id);
      if (row) {
        row.display_name = p.display_name;
        row.plan = (p.plan ?? "essencial") as Plan;
        row.group_id = p.group_id ?? null;
      }
    });
    (roles ?? []).forEach((r: any) => {
      const row = byId.get(r.user_id);
      if (row) row.roles = [...(row.roles ?? []), r.role];
    });
    (members ?? []).forEach((m: any) => {
      const row = byId.get(m.user_id);
      if (row) row.workspaces = [...(row.workspaces ?? []), { id: m.workspace_id, name: m.workspaces?.name, role: m.role, member_profile: m.member_profile ?? "operational" }];
    });

    return { accounts: Array.from(byId.values()) };
  });

export const adminCreateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    email: string;
    password: string;
    displayName: string;
    plan: Plan;
    workspaceId?: string | null;
    workspaceRole?: "owner" | "admin" | "member";
    memberProfile?: MemberProfile;
    groupId?: string | null;
  }) => {
    if (!input.email || !/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Email inválido");
    if (!input.password || input.password.length < 6) throw new Error("Senha precisa ter ao menos 6 caracteres");
    if (!["essencial", "pro", "premium"].includes(input.plan)) throw new Error("Plano inválido");
    if (input.workspaceRole === "owner") throw new Error("Crie a conta como membro e use Transferir propriedade depois.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName || data.email.split("@")[0] },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Falha ao criar conta");

    const newId = created.user.id;

    try {
      const { error: profileError } = await supabaseAdmin.from("profiles").update({
        display_name: data.displayName || data.email.split("@")[0], plan: data.plan, group_id: data.groupId ?? null,
      }).eq("id", newId);
      if (profileError) throw new Error(profileError.message);
      if (data.workspaceId) {
        const { error: membershipError } = await context.supabase.rpc("platform_assign_workspace_member", {
          ws: data.workspaceId, target: newId, new_role: data.workspaceRole ?? "member",
          new_profile: normalizeMemberProfile(data.workspaceRole ?? "member", data.memberProfile),
        });
        if (membershipError) throw new Error(membershipError.message);
      }
    } catch (error) {
      // Account is newly created and never assigned owner; compensate failure.
      const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(newId);
      if (cleanupError) throw new Error("Falha ao configurar conta; revise a conta recém-criada no painel.");
      throw error;
    }

    return { id: newId, email: data.email };
  });

export const adminSetAccountGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; groupId: string | null }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ group_id: data.groupId })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("account_groups")
      .select("id, name, description")
      .order("name");
    if (error) throw new Error(error.message);
    return { groups: data ?? [] };
  });

export const adminCreateGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; description?: string | null }) => {
    if (!input.name?.trim()) throw new Error("Nome do grupo é obrigatório");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("account_groups")
      .insert({ name: data.name.trim(), description: data.description ?? null })
      .select("id, name, description")
      .single();
    if (error) throw new Error(error.message);
    return { group: row };
  });

export const adminDeleteGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { groupId: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("account_groups").delete().eq("id", data.groupId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetAccountPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; plan: Plan }) => {
    if (!["essencial", "pro", "premium"].includes(input.plan)) throw new Error("Plano inválido");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({ plan: data.plan }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; password: string }) => {
    if (!input.password || input.password.length < 6) throw new Error("Senha precisa ter ao menos 6 caracteres");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminAssignToWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    userId: string;
    workspaceId: string;
    role?: "owner" | "admin" | "member";
    memberProfile?: MemberProfile;
  }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    if (data.role === "owner") throw new Error("Use Transferir propriedade para alterar o dono.");
    const { error } = await context.supabase.rpc("platform_assign_workspace_member", {
      ws: data.workspaceId, target: data.userId, new_role: data.role ?? "member",
      new_profile: normalizeMemberProfile(data.role ?? "member", data.memberProfile),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRemoveFromWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; workspaceId: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { error } = await context.supabase.rpc("platform_remove_workspace_member", {
      ws: data.workspaceId, target: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    if (data.userId === (context as any).userId) throw new Error("Você não pode excluir sua própria conta");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: privileged, error: roleError } = await supabaseAdmin.from("user_roles")
      .select("role").eq("user_id", data.userId).eq("role", "superadmin").maybeSingle();
    if (roleError || privileged) throw new Error("A conta Superadmin é protegida; use recuperação administrativa.");
    const { count: owned, error: ownerError } = await supabaseAdmin.from("workspaces")
      .select("id", { count: "exact", head: true }).eq("owner_id", data.userId);
    if (ownerError || owned == null || owned > 0) throw new Error("Transfira os espaços da conta antes de excluí-la.");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperadmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, tier")
      .order("name");
    if (error) throw new Error(error.message);
    return { workspaces: data ?? [] };
  });

/** Troca Operacional ↔ Estratégico sem alterar o Papel no espaço. */
export const adminSetMemberProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; workspaceId: string; memberProfile: MemberProfile }) => {
    if (!["operational", "strategic"].includes(input.memberProfile)) throw new Error("Perfil inválido");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const { error } = await context.supabase.rpc("platform_set_member_profile", {
      ws: data.workspaceId, target: data.userId, new_profile: data.memberProfile,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
