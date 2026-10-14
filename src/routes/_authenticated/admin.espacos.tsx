import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Pencil, Map as MapIcon, Users } from "lucide-react";
import {
  adminListWorkspacesFull,
  adminCreateWorkspace,
  adminUpdateWorkspace,
  adminDeleteWorkspace,
} from "@/lib/admin/workspaces.functions";
import { adminListAccounts } from "@/lib/admin/accounts.functions";
import { setCurrentWorkspaceId } from "@/lib/workspace/current";
import { primeWorkspaceTierCache } from "@/lib/workspace/useWorkspaceTier";
import { appPrompt, appConfirm } from "@/components/ui/app-dialogs";


export const Route = createFileRoute("/_authenticated/admin/espacos")({
  ssr: false,
  head: () => ({ meta: [{ title: "Espaços — Admin" }] }),
  component: AdminEspacosPage,
});

type Ws = {
  id: string; name: string; slug: string; tier: number;
  owner_id: string; owner_name: string; member_count: number; created_at: string;
};
type Account = { id: string; email: string; display_name?: string };

function AdminEspacosPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(adminListWorkspacesFull);
  const accListFn = useServerFn(adminListAccounts);
  const createFn = useServerFn(adminCreateWorkspace);
  const updateFn = useServerFn(adminUpdateWorkspace);
  const deleteFn = useServerFn(adminDeleteWorkspace);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Ws[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [name, setName] = useState("");
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [ownerId, setOwnerId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return false; }
    const { data } = await supabase.from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "superadmin").maybeSingle();
    return !!data;
  };

  const load = async () => {
    setLoading(true);
    const ok = await check();
    setAllowed(ok);
    if (!ok) { setLoading(false); return; }
    try {
      const [w, a] = await Promise.all([listFn(), accListFn()]);
      setItems((w as any).workspaces);
      setAccounts((a as any).accounts);
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFn({ data: { name: name.trim(), tier, ownerId: ownerId || null } });
      toast.success("Espaço criado.");
      setName(""); setOwnerId("");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    setBusy(false);
  };

  const rename = async (ws: Ws) => {
    const newName = await appPrompt({ title: "Renomear espaço", defaultValue: ws.name, placeholder: "Novo nome" });
    if (!newName || newName === ws.name) return;
    try {
      await updateFn({ data: { id: ws.id, name: newName } });
      toast.success("Renomeado.");
      setItems((p) => p.map((x) => x.id === ws.id ? { ...x, name: newName } : x));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const changeTier = async (ws: Ws, newTier: 1 | 2 | 3) => {
    try {
      await updateFn({ data: { id: ws.id, tier: newTier } });
      setItems((p) => p.map((x) => x.id === ws.id ? { ...x, tier: newTier } : x));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const remove = async (ws: Ws) => {
    if (!(await appConfirm({ title: `Excluir "${ws.name}"?`, description: "Todos os dados do espaço serão perdidos. Isto não pode ser desfeito.", confirmLabel: "Excluir", destructive: true }))) return;
    try {
      await deleteFn({ data: { id: ws.id } });
      toast.success("Espaço excluído.");
      setItems((p) => p.filter((x) => x.id !== ws.id));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const openEditor = (ws: Ws) => {
    primeWorkspaceTierCache(ws.id, ws.tier);
    setCurrentWorkspaceId(ws.id);
    try { localStorage.setItem("lastWorkspaceId", ws.id); } catch {}
    navigate({ to: "/office/editor" });
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!allowed) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center glass-panel rounded-2xl p-8">
        <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={() => navigate({ to: "/admin" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Espaços</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Crie espaços, edite mapas direto daqui e atribua donos.
        </p>

        <form onSubmit={create} className="glass-panel rounded-2xl p-6 mb-8 grid sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1.5">Nome do espaço</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2}
              placeholder="Ex: Prestativa SP"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">Nível</label>
            <select value={tier} onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
              <option value={1}>Nível 1</option>
              <option value={2}>Nível 2</option>
              <option value={3}>Nível 3</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">Dono</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="">— Eu (admin) —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.display_name ?? a.email}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <button type="submit" disabled={busy}
              className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 shadow-glow disabled:opacity-50">
              <Plus size={14} /> {busy ? "Criando…" : "Criar espaço"}
            </button>
          </div>
        </form>

        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Espaços existentes ({items.length})
        </div>
        <div className="space-y-2">
          {items.map((ws) => (
            <div key={ws.id} className="glass-panel rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    <span>{ws.name}</span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">N{ws.tier}</span>
                  </div>
                  <div className="text-xs text-muted-foreground inline-flex items-center gap-3 mt-0.5">
                    <span>Dono: {ws.owner_name}</span>
                    <span className="inline-flex items-center gap-1"><Users size={11} /> {ws.member_count}</span>
                    <span className="font-mono opacity-50">{ws.slug}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <select value={ws.tier} onChange={(e) => changeTier(ws, Number(e.target.value) as 1 | 2 | 3)}
                    className="rounded-lg border bg-background px-2 py-1 text-xs">
                    <option value={1}>N1</option><option value={2}>N2</option><option value={3}>N3</option>
                  </select>
                  <button onClick={() => openEditor(ws)} title="Editar mapa / cenário"
                    className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium inline-flex items-center gap-1.5">
                    <MapIcon size={12} /> Editar mapa
                  </button>
                  <button onClick={() => rename(ws)} title="Renomear"
                    className="p-2 rounded-lg bg-muted hover:bg-muted/70"><Pencil size={14} /></button>
                  <button onClick={() => remove(ws)} title="Excluir"
                    className="p-2 rounded-lg bg-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
