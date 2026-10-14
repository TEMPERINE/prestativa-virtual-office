import { adminTransferWorkspaceOwnership } from "@/lib/admin/workspaces.functions";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Plus, KeyRound, Trash2, UserPlus, X, FolderPlus, Folder } from "lucide-react";
import {
  adminListAccounts,
  adminCreateAccount,
  adminSetAccountPlan,
  adminResetPassword,
  adminDeleteAccount,
  adminAssignToWorkspace,
  adminRemoveFromWorkspace,
  adminListWorkspaces,
  adminListGroups,
  adminCreateGroup,
  adminDeleteGroup,
  adminSetAccountGroup,
  adminSetMemberProfile,
} from "@/lib/admin/accounts.functions";
import { appPrompt, appConfirm } from "@/components/ui/app-dialogs";


export const Route = createFileRoute("/_authenticated/admin/contas")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contas — Admin" }] }),
  component: AdminContasPage,
});

type Plan = "essencial" | "pro" | "premium";
const ROLE_LABEL: Record<string, string> = { member: "Membro", admin: "Admin", owner: "Dono" };

type Account = {
  id: string;
  email: string;
  display_name?: string;
  plan?: Plan;
  group_id?: string | null;
  roles?: string[];
  workspaces?: Array<{ id: string; name?: string; role: string; member_profile?: string }>;
  created_at: string;
  last_sign_in_at: string | null;
};

type Workspace = { id: string; name: string; tier: number };
type Group = { id: string; name: string; description?: string | null };

const NO_GROUP = "__no_group__";

function AdminContasPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(adminListAccounts);
  const wsListFn = useServerFn(adminListWorkspaces);
  const createFn = useServerFn(adminCreateAccount);
  const setPlanFn = useServerFn(adminSetAccountPlan);
  const resetPwFn = useServerFn(adminResetPassword);
  const deleteFn = useServerFn(adminDeleteAccount);
  const transferFn = useServerFn(adminTransferWorkspaceOwnership);
  const assignFn = useServerFn(adminAssignToWorkspace);
  const setProfileFn = useServerFn(adminSetMemberProfile);
  const unassignFn = useServerFn(adminRemoveFromWorkspace);
  const listGroupsFn = useServerFn(adminListGroups);
  const createGroupFn = useServerFn(adminCreateGroup);
  const deleteGroupFn = useServerFn(adminDeleteGroup);
  const setGroupFn = useServerFn(adminSetAccountGroup);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // create form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [plan, setPlan] = useState<Plan>("essencial");
  const [wsId, setWsId] = useState<string>("");
  const [wsRole, setWsRole] = useState<"owner" | "admin" | "member">("member");
  const [memberProfile, setMemberProfile] = useState<"operational" | "strategic">("operational");
  const [groupId, setGroupId] = useState<string>("");

  const checkAdmin = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return false; }
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id)
      .eq("role", "superadmin")
      .maybeSingle();
    return !!data;
  };

  const load = async () => {
    setLoading(true);
    const ok = await checkAdmin();
    setAllowed(ok);
    if (!ok) { setLoading(false); return; }
    try {
      const [a, w, g] = await Promise.all([listFn(), wsListFn(), listGroupsFn()]);
      setAccounts((a as any).accounts);
      setWorkspaces((w as any).workspaces);
      setGroups((g as any).groups);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar.");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFn({
        data: {
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          plan,
          workspaceId: wsId || null,
          workspaceRole: wsRole,
          memberProfile: wsRole === "member" ? memberProfile : undefined,
          groupId: groupId || null,
        },
      });
      toast.success("Conta criada!");
      setEmail(""); setPassword(""); setDisplayName(""); setWsId(""); setMemberProfile("operational");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao criar conta.");
    } finally {
      setBusy(false);
    }
  };

  const changePlan = async (userId: string, newPlan: Plan) => {
    try {
      await setPlanFn({ data: { userId, plan: newPlan } });
      toast.success("Plano atualizado.");
      setAccounts((prev) => prev.map((a) => a.id === userId ? { ...a, plan: newPlan } : a));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const changeGroup = async (userId: string, newGroupId: string | null) => {
    try {
      await setGroupFn({ data: { userId, groupId: newGroupId } });
      setAccounts((prev) => prev.map((a) => a.id === userId ? { ...a, group_id: newGroupId } : a));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const resetPw = async (userId: string) => {
    const pw = await appPrompt({
      title: "Redefinir senha",
      description: "Defina uma nova senha provisória (mín. 6 caracteres).",
      placeholder: "Nova senha",
      inputType: "password",
      minLength: 6,
      confirmLabel: "Redefinir",
    });
    if (!pw || pw.length < 6) return;
    try {
      await resetPwFn({ data: { userId, password: pw } });
      toast.success("Senha redefinida.");
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const removeAccount = async (acc: Account) => {
    const ok = await appConfirm({
      title: "Excluir conta?",
      description: `A conta de ${acc.email} será apagada definitivamente. Isto não pode ser desfeito.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFn({ data: { userId: acc.id } });
      toast.success("Conta excluída.");
      setAccounts((prev) => prev.filter((a) => a.id !== acc.id));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };


  const changeProfile = async (userId: string, workspaceId: string, memberProfile: "operational" | "strategic") => {
    try {
      await setProfileFn({ data: { userId, workspaceId, memberProfile } });
      setAccounts((prev) => prev.map((a) => a.id === userId
        ? { ...a, workspaces: (a.workspaces ?? []).map((w) => w.id === workspaceId ? { ...w, member_profile: memberProfile } : w) }
        : a));
      toast.success(memberProfile === "strategic" ? "Perfil alterado para Estratégico." : "Perfil alterado para Operacional.");
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const assign = async (userId: string, workspaceId: string, role: "owner" | "admin" | "member", memberProfile?: "operational" | "strategic") => {
    if (!workspaceId) return;
    try {
      if (role === "owner") {
        if (!(await appConfirm({ title: "Transferir propriedade?", description: "Esta conta será o novo dono. O dono anterior continuará como membro.", confirmLabel: "Transferir" }))) return;
        await transferFn({ data: { workspaceId, newOwnerId: userId } });
      } else {
        await assignFn({ data: { userId, workspaceId, role, memberProfile: role === "member" ? memberProfile : undefined } });
      }
      toast.success("Acesso ao espaço concedido.");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const unassign = async (userId: string, workspaceId: string) => {
    try {
      await unassignFn({ data: { userId, workspaceId } });
      setAccounts((prev) => prev.map((a) => a.id === userId
        ? { ...a, workspaces: (a.workspaces ?? []).filter((w) => w.id !== workspaceId) }
        : a));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const newGroup = async () => {
    const name = await appPrompt({
      title: "Novo grupo",
      description: "Crie um grupo (ex: empresa) para organizar as contas.",
      placeholder: "Nome do grupo",
      confirmLabel: "Criar",
    });
    if (!name?.trim()) return;
    try {
      const res: any = await createGroupFn({ data: { name: name.trim() } });
      setGroups((prev) => [...prev, res.group].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success("Grupo criado.");
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const removeGroup = async (g: Group) => {
    const ok = await appConfirm({
      title: `Excluir grupo "${g.name}"?`,
      description: "As contas deste grupo ficarão sem grupo. As contas em si não serão apagadas.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteGroupFn({ data: { groupId: g.id } });
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
      setAccounts((prev) => prev.map((a) => a.group_id === g.id ? { ...a, group_id: null } : a));
      toast.success("Grupo excluído.");
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  // Agrupa contas por grupo (+ "sem grupo" no final)
  const grouped = useMemo(() => {
    const buckets = new Map<string, Account[]>();
    groups.forEach((g) => buckets.set(g.id, []));
    buckets.set(NO_GROUP, []);
    accounts.forEach((a) => {
      const key = a.group_id && buckets.has(a.group_id) ? a.group_id : NO_GROUP;
      buckets.get(key)!.push(a);
    });
    return buckets;
  }, [accounts, groups]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!allowed) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center glass-panel rounded-2xl p-8">
        <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground">Essa página é só para administradores.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={() => navigate({ to: "/workspaces" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Contas</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Crie contas, defina planos, organize por grupo (ex: empresa) e atribua acesso a espaços.
        </p>

        {/* Grupos */}
        <div className="glass-panel rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Folder size={14} /> Grupos ({groups.length})
            </h2>
            <button onClick={newGroup}
              className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary">
              <FolderPlus size={12} /> Novo grupo
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.length === 0 && (
              <span className="text-xs text-muted-foreground italic">Nenhum grupo ainda. Crie um para organizar.</span>
            )}
            {groups.map((g) => {
              const count = (grouped.get(g.id) ?? []).length;
              return (
                <span key={g.id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted">
                  <Folder size={11} /> {g.name}
                  <span className="text-muted-foreground">· {count}</span>
                  <button onClick={() => removeGroup(g)} className="hover:text-red-500 ml-0.5" title="Excluir grupo">
                    <X size={10} />
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        {/* Nova conta */}
        <form onSubmit={create} className="glass-panel rounded-2xl p-6 mb-10 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <UserPlus size={14} /> Nova conta
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Email" value={email} onChange={setEmail} type="email" required placeholder="pessoa@email.com" />
            <Field label="Nome de exibição" value={displayName} onChange={setDisplayName} placeholder="Ex: João Silva" />
            <Field label="Senha provisória" value={password} onChange={setPassword} type="text" required placeholder="mín. 6 caracteres" />
            <SelectField label="Plano" value={plan} onChange={(v) => setPlan(v as Plan)}
              options={[
                { value: "essencial", label: "Essencial (nível 1)" },
                { value: "pro", label: "Pro (níveis 1–2)" },
                { value: "premium", label: "Premium (níveis 1–3)" },
              ]} />
            <SelectField label="Grupo (empresa)" value={groupId} onChange={setGroupId}
              options={[{ value: "", label: "— Sem grupo —" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} />
            <SelectField label="Adicionar ao espaço (opcional)" value={wsId} onChange={setWsId}
              options={[{ value: "", label: "— Nenhum —" }, ...workspaces.map((w) => ({ value: w.id, label: `${w.name} (N${w.tier})` }))]} />
            <SelectField label="Papel no espaço" value={wsRole} onChange={(v) => setWsRole(v as any)}
              options={[
                { value: "member", label: "Membro" },
                { value: "admin", label: "Admin" },
              ]} />
            {wsRole === "member" && (
              <div>
                <SelectField label="Perfil do membro" value={memberProfile} onChange={(v) => setMemberProfile(v as any)}
                  options={[
                    { value: "operational", label: "Operacional" },
                    { value: "strategic", label: "Estratégico" },
                  ]} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {memberProfile === "operational"
                    ? "Participa normalmente do escritório e das reuniões, mas não pode iniciar gravações."
                    : "Possui os mesmos acessos do Membro e também pode iniciar gravações."}
                </p>
              </div>
            )}
          </div>
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 shadow-glow disabled:opacity-50">
            <Plus size={14} /> {busy ? "Criando…" : "Criar conta"}
          </button>
        </form>

        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Contas existentes ({accounts.length})
        </h2>

        {/* Grupos com contas */}
        <div className="space-y-6">
          {[...groups, { id: NO_GROUP, name: "Sem grupo" } as Group].map((g) => {
            const list = grouped.get(g.id) ?? [];
            if (list.length === 0 && g.id === NO_GROUP) return null;
            return (
              <div key={g.id}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Folder size={14} className="text-primary" />
                  <h3 className="text-sm font-semibold">{g.name}</h3>
                  <span className="text-xs text-muted-foreground">({list.length})</span>
                </div>
                <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                  {list.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic px-3 py-2">Nenhuma conta neste grupo.</div>
                  ) : (
                    list.map((a) => (
                      <div key={a.id} className="glass-panel rounded-xl p-4 ml-2">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                              <span>{a.display_name ?? a.email}</span>
                              {(a.roles?.includes("superadmin") || a.roles?.includes("admin")) && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">{a.roles?.includes("superadmin") ? "Superadmin" : "Admin (legado)"}</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {a.email} · último login: {a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString() : "nunca"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              value={a.group_id ?? ""}
                              onChange={(e) => changeGroup(a.id, e.target.value || null)}
                              className="rounded-lg border bg-background px-2 py-1 text-xs"
                              title="Grupo"
                            >
                              <option value="">— Sem grupo —</option>
                              {groups.map((gg) => <option key={gg.id} value={gg.id}>{gg.name}</option>)}
                            </select>
                            <select
                              value={a.plan ?? "essencial"}
                              onChange={(e) => changePlan(a.id, e.target.value as Plan)}
                              className="rounded-lg border bg-background px-2 py-1 text-xs"
                            >
                              <option value="essencial">Essencial</option>
                              <option value="pro">Pro</option>
                              <option value="premium">Premium</option>
                            </select>
                            <button onClick={() => resetPw(a.id)} title="Redefinir senha"
                              className="p-2 rounded-lg bg-muted hover:bg-muted/70"><KeyRound size={14} /></button>
                            <button disabled={a.roles?.includes("superadmin")} onClick={() => removeAccount(a)} title="Excluir conta"
                              className="p-2 rounded-lg bg-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
                          </div>
                        </div>

                        <div className="mt-3 pl-1">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Espaços</div>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {(a.workspaces ?? []).length === 0 && (
                              <span className="text-xs text-muted-foreground italic">Sem acesso a nenhum espaço.</span>
                            )}
                            {(a.workspaces ?? []).map((w) => (
                              <span key={w.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted">
                                {w.name ?? w.id.slice(0, 6)} · {ROLE_LABEL[w.role] ?? w.role}
                                {w.role === "member" && (
                                  <>
                                    {" · "}
                                    <select
                                      aria-label="Perfil do membro"
                                      value={w.member_profile === "strategic" ? "strategic" : "operational"}
                                      onChange={(e) => changeProfile(a.id, w.id, e.target.value as any)}
                                      className="bg-transparent text-xs underline decoration-dotted cursor-pointer outline-none"
                                    >
                                      <option value="operational">Operacional</option>
                                      <option value="strategic">Estratégico</option>
                                    </select>
                                  </>
                                )}
                                <button onClick={() => unassign(a.id, w.id)} className="hover:text-red-500">
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <AssignControl
                            workspaces={workspaces.filter((w) => !(a.workspaces ?? []).some((aw) => aw.id === w.id))}
                            onAssign={(workspaceId, role, mp) => assign(a.id, workspaceId, role, mp)}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} required={required}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function AssignControl({ workspaces, onAssign }: {
  workspaces: Workspace[];
  onAssign: (workspaceId: string, role: "owner" | "admin" | "member", memberProfile?: "operational" | "strategic") => void;
}) {
  const [mp, setMp] = useState<"operational" | "strategic">("operational");
  const [wsId, setWsId] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("member");
  if (workspaces.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={wsId} onChange={(e) => setWsId(e.target.value)}
        className="rounded-lg border bg-background px-2 py-1 text-xs">
        <option value="">+ adicionar a um espaço…</option>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} (N{w.tier})</option>)}
      </select>
      {wsId && (
        <>
          <select value={role} onChange={(e) => setRole(e.target.value as any)}
            className="rounded-lg border bg-background px-2 py-1 text-xs">
            <option value="member">Membro</option>
            <option value="admin">Admin</option>
            <option value="owner">Transferir propriedade</option>
          </select>
          {role === "member" && (
            <select value={mp} onChange={(e) => setMp(e.target.value as any)} aria-label="Perfil do membro"
              className="rounded-lg border bg-background px-2 py-1 text-xs">
              <option value="operational">Operacional</option>
              <option value="strategic">Estratégico</option>
            </select>
          )}
          <button onClick={() => { onAssign(wsId, role, mp); setWsId(""); setMp("operational"); }}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90">
            Conceder
          </button>
        </>
      )}
    </div>
  );
}
