import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Pencil } from "lucide-react";
import {
  adminListSkins,
  adminUpdateSkin,
  adminDeleteSkin,
} from "@/lib/admin/sprites.functions";
import { adminListWorkspacesFull } from "@/lib/admin/workspaces.functions";
import { invalidateSpriteCatalog } from "@/lib/sprites/useSpriteCatalog";
import { appPrompt, appConfirm } from "@/components/ui/app-dialogs";



export const Route = createFileRoute("/_authenticated/admin/personagens")({
  ssr: false,
  head: () => ({ meta: [{ title: "Personagens — Admin" }] }),
  component: AdminPersonagensPage,
});

type Facing = "down" | "up" | "left" | "right";

type Skin = {
  id: string;
  label: string;
  gender: "m" | "f" | "n";
  workspace_id: string | null;
  workspace_name: string | null;
  sheets: Record<Facing, string>;
  dims: Record<Facing, { w: number; h: number }>;
  mirror_right_from_left: boolean;
};

type Ws = { id: string; name: string };

function publicUrlFor(path: string): string {
  if (path.startsWith("http")) return path;
  const { data } = supabase.storage.from("sprite-sheets").getPublicUrl(path);
  return data.publicUrl;
}

function AdminPersonagensPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(adminListSkins);
  const wsListFn = useServerFn(adminListWorkspacesFull);
  const updateFn = useServerFn(adminUpdateSkin);
  const deleteFn = useServerFn(adminDeleteSkin);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);

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
      const [s, w] = await Promise.all([listFn(), wsListFn()]);
      setSkins((s as any).skins);
      setWorkspaces((w as any).workspaces.map((x: any) => ({ id: x.id, name: x.name })));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);


  const rename = async (s: Skin) => {
    const newLabel = await appPrompt({ title: "Renomear personagem", defaultValue: s.label, placeholder: "Novo rótulo" });
    if (!newLabel || newLabel === s.label) return;
    try {
      await updateFn({ data: { id: s.id, label: newLabel } });
      invalidateSpriteCatalog();
      setSkins((p) => p.map((x) => x.id === s.id ? { ...x, label: newLabel } : x));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const moveToWs = async (s: Skin, newWsId: string) => {
    try {
      await updateFn({ data: { id: s.id, workspaceId: newWsId || null } });
      invalidateSpriteCatalog();
      load();
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const remove = async (s: Skin) => {
    if (!(await appConfirm({ title: `Excluir "${s.label}"?`, confirmLabel: "Excluir", destructive: true }))) return;
    try {
      await deleteFn({ data: { id: s.id } });
      invalidateSpriteCatalog();
      setSkins((p) => p.filter((x) => x.id !== s.id));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!allowed) return <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md text-center glass-panel rounded-2xl p-8"><h1 className="text-lg font-semibold mb-2">Acesso restrito</h1></div></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={() => navigate({ to: "/admin" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Personagens (skins)</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Gerenciamento das skins existentes. Criação de novas skins está suspensa nesta fase do piloto.
        </p>


        <div className="glass-panel rounded-2xl p-6 mb-10 border border-dashed">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Novo personagem — temporariamente desativado
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            O fluxo de criação de skins (upload de folha e geração com IA) está suspenso nesta fase de validação.
            Estamos focando o piloto na Prestativa com as 9 skins padrão. A função volta depois da escala.
          </p>
        </div>


        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Personagens dinâmicos ({skins.length})
        </div>
        {skins.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            Nenhum personagem dinâmico ainda. As 9 skins padrão (Márcio, Loira, etc.) continuam disponíveis automaticamente.
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {skins.map((s) => (
            <div key={s.id} className="glass-panel rounded-xl p-4">
              <div className="flex items-start gap-3">
                <img src={publicUrlFor(s.sheets.down)} alt={s.label}
                  className="w-16 h-24 object-cover rounded bg-muted"
                  style={{ objectPosition: "left top", objectFit: "none" }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">{s.id}</div>
                  <div className="text-[10px] uppercase tracking-wider mt-1">
                    {s.workspace_id ? (
                      <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{s.workspace_name}</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-muted">Global</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <select value={s.workspace_id ?? ""} onChange={(e) => moveToWs(s, e.target.value)}
                  className="flex-1 rounded-lg border bg-background px-2 py-1 text-xs">
                  <option value="">Global</option>
                  {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button onClick={() => rename(s)} title="Renomear"
                  className="p-1.5 rounded-lg bg-muted hover:bg-muted/70"><Pencil size={12} /></button>
                <button onClick={() => remove(s)} title="Excluir"
                  className="p-1.5 rounded-lg bg-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
