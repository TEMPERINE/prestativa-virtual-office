import { usesSuperadminTransport } from "@/lib/admin/workspace-access";
import { adminManageSavePoints } from "@/lib/admin/workspace-resources.functions";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, Trash2, FolderOpen, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentWorkspaceId } from "@/lib/workspace/current";
import { normalizeMapOverrides } from "@/lib/map-sync";
import type { MapOverrides } from "@/lib/map-overrides";
import { appPrompt, appConfirm } from "@/components/ui/app-dialogs";

type SavePoint = { id: string; name: string; created_at: string; data: unknown };

export function MapSavePoints({
  overrides,
  onLoad,
}: {
  overrides: MapOverrides;
  onLoad: (o: MapOverrides) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavePoint[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ws = getCurrentWorkspaceId();
    if (!ws) return;
    setBusy(true);
    try {
      const result = await usesSuperadminTransport()
        ? { data: (await adminManageSavePoints({ data: { workspaceId: ws, action: "list" } })).rows, error: null }
        : await supabase
        .from("map_save_points")
        .select("id, name, created_at, data")
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false });
      const { data, error } = result;
      if (error) throw error;
      setList((data ?? []) as SavePoint[]);
    } catch {
      toast.error("Erro ao listar Save Points. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const create = async () => {
    const ws = getCurrentWorkspaceId();
    if (!ws) return toast.error("Nenhum escritório ativo.");
    const name = await appPrompt({
      title: "Novo Save Point",
      description: "Dê um nome para este save",
      defaultValue: new Date().toLocaleString("pt-BR"),
    });
    if (!name || !String(name).trim()) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await usesSuperadminTransport()
        ? (await adminManageSavePoints({ data: { workspaceId: ws, action: "create", name: String(name).trim(), map: overrides } }), { error: null })
        : await supabase.from("map_save_points").insert({
        workspace_id: ws,
        name: String(name).trim(),
        data: JSON.parse(JSON.stringify(overrides)),
        created_by: u.user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Save Point criado");
      await refresh();
    } catch {
      toast.error("Erro ao salvar Save Point. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const load = async (sp: SavePoint) => {
    const ok = await appConfirm({
      title: `Carregar "${sp.name}"?`,
      description: "O mapa atual no editor será substituído. Clique em Salvar depois para aplicar no escritório.",
    });
    if (!ok) return;
    const norm = normalizeMapOverrides(sp.data);
    if (!norm) return toast.error("Save Point vazio ou inválido.");
    onLoad(norm);
    setOpen(false);
    toast.success("Save Point carregado — clique em Salvar para aplicar");
  };

  const remove = async (sp: SavePoint) => {
    const ok = await appConfirm({ title: `Excluir "${sp.name}"?`, description: "Isso não pode ser desfeito.", destructive: true });
    if (!ok) return;
    const ws = getCurrentWorkspaceId();
    if (!ws) return;
    setBusy(true);
    try {
      const { error } = await usesSuperadminTransport()
        ? (await adminManageSavePoints({ data: { workspaceId: ws, action: "delete", id: sp.id } }), { error: null })
        : await supabase.from("map_save_points").delete().eq("id", sp.id).eq("workspace_id", ws);
      if (error) throw error;
      await refresh();
    } catch {
      toast.error("Erro ao excluir Save Point. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground inline-flex items-center gap-1"
      >
        <Save size={12} /> Save Points
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-background/70 flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className="bg-card text-card-foreground border rounded-lg w-[440px] max-h-[70vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="font-semibold text-sm">Save Points do mapa</h3>
              <button onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
            <div className="p-3 border-b">
              <button onClick={create} disabled={busy} className="w-full text-sm px-3 py-2 rounded bg-primary text-primary-foreground inline-flex items-center justify-center gap-2">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar estado atual
              </button>
            </div>
            <div className="overflow-auto p-2 space-y-1">
              {list.length === 0 && !busy && <p className="text-xs text-muted-foreground p-2">Nenhum Save Point ainda.</p>}
              {list.map((sp) => {
                const d = sp.data as MapOverrides;
                return (
                  <div key={sp.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{sp.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(sp.created_at).toLocaleString("pt-BR")} · {d?.props?.length ?? 0} elementos · {Object.keys(d?.spawnPoints ?? {}).length} spawns
                      </div>
                    </div>
                    <button onClick={() => load(sp)} className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1">
                      <FolderOpen size={12} /> Carregar
                    </button>
                    <button onClick={() => remove(sp)} className="text-xs p-1 rounded text-destructive"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
