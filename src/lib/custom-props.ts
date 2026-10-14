import { usesSuperadminTransport } from "@/lib/admin/workspace-access";
// Persistência e helpers para os elementos personalizados (galeria do editor).
// Os frames são guardados como data URLs (base64 PNG) na coluna `frames` (jsonb).
// Isso evita depender de bucket público de storage.

import { supabase } from "@/integrations/supabase/client";
import { setCustomProps, type PropDef } from "./prop-catalog";


import { getCurrentWorkspaceId } from "@/lib/workspace/current";

export async function loadCustomPropsFromCloud(): Promise<void> {
  const ws = getCurrentWorkspaceId();
  if (!ws) { setCustomProps([]); return; }
  try {
    const result = await usesSuperadminTransport()
      ? { data: (await (await import("@/lib/admin/workspace-resources.functions")).adminManageCustomProps({ data: { workspaceId: ws, action: "list" } })).rows, error: null }
      : await supabase
      .from("custom_props")
      .select("id,label,frames,default_w,aspect_ratio")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: true });
    const { data, error } = result;
    if (error) throw error;
    const defs: PropDef[] = (data ?? []).map((r) => {
      const frames = (Array.isArray(r.frames) ? (r.frames as unknown as string[]) : []);
      return {
        id: r.id,
        label: r.label,
        frames,
        defaultW: r.default_w ?? 0.08,
        aspectRatio: r.aspect_ratio ?? 1,
        interactive: frames.length > 1,
        interactKey: "x",
        custom: true,
      };
    });
    setCustomProps(defs);
  } catch {
    // Keep the existing catalog; never let a void background load reject.
    console.warn("[custom-props] Não foi possível carregar a galeria.");
  }
}

export async function deleteCustomProp(id: string): Promise<void> {
  const ws = getCurrentWorkspaceId();
  if (!ws) throw new Error("Workspace inválido.");
  const { error } = await usesSuperadminTransport()
    ? (await (await import("@/lib/admin/workspace-resources.functions")).adminManageCustomProps({ data: { workspaceId: ws, action: "delete", id } }), { error: null })
    : await supabase.from("custom_props").delete().eq("id", id).eq("workspace_id", ws);
  if (error) throw error;
  await loadCustomPropsFromCloud();
}

/** Lê o arquivo como HTMLImageElement. */
function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/** Recorta a imagem em N frames horizontais e devolve PNG data URLs. */
function splitFrames(img: HTMLImageElement, frameCount: number): string[] {
  const fw = Math.floor(img.naturalWidth / frameCount);
  const fh = img.naturalHeight;
  const out: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
    out.push(canvas.toDataURL("image/png"));
  }
  return out;
}

export type UploadOptions = {
  label: string;
  file: File;
  frameCount: number; // 1 = imagem única; >1 = sprite sheet horizontal
};

export async function uploadCustomProp(opts: UploadOptions): Promise<void> {
  const { label, file, frameCount } = opts;
  if (!label.trim()) throw new Error("Informe um nome para o elemento.");
  if (frameCount < 1) throw new Error("Quantidade de frames inválida.");

  const img = await readImage(file);
  if (img.naturalWidth % frameCount !== 0) {
    console.warn("[custom-props] largura não divisível pelo nº de frames; frames podem ficar levemente cortados.");
  }
  const frames = splitFrames(img, frameCount);

  const fw = Math.floor(img.naturalWidth / frameCount);
  const fh = img.naturalHeight;
  const aspectRatio = fw / fh;
  // largura padrão proporcional: assume ~80px de referência sobre largura típica do mapa.
  const defaultW = Math.min(0.25, Math.max(0.04, fw / 1200));

  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const ws = getCurrentWorkspaceId();
  if (!ws) throw new Error("Workspace inválido.");
  const prop = { id, label: label.trim(), frames, default_w: defaultW, aspect_ratio: aspectRatio };
  const { error } = await usesSuperadminTransport()
    ? (await (await import("@/lib/admin/workspace-resources.functions")).adminManageCustomProps({ data: { workspaceId: ws, action: "create", prop } }), { error: null })
    : await supabase.from("custom_props").insert({
    workspace_id: ws,
    id,
    label: label.trim(),
    frames,
    default_w: defaultW,
    aspect_ratio: aspectRatio,
    created_by: userId,
  });
  if (error) throw error;
  await loadCustomPropsFromCloud();
}
