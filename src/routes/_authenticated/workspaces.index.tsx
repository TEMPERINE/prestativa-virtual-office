import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, LogOut, ArrowRight, Sparkles, Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { OFFICE_THEMES, DEFAULT_THEME_ID, CUSTOM_THEME_ID } from "@/lib/office-themes";
import { getTierCaps } from "@/lib/workspace/tiers";
import { getPlanInfo, type AccountPlan, DEFAULT_PLAN } from "@/lib/account/plans";
import { VersionBadge } from "@/components/VersionBadge";

export const Route = createFileRoute("/_authenticated/workspaces/")({
  head: () => ({ meta: [{ title: "Seus espaços — Virtual Office" }] }),
  component: WorkspacesHubPage,
});

type WorkspaceCard = {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  role: string;
  tier: number;
  previewUrl: string | null;
};

type InviteRow = {
  id: string;
  token: string;
  role: string;
  workspace_id: string;
  workspaces: { name: string; description: string | null } | null;
};

function WorkspacesHubPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ display_name: string; plan: AccountPlan } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceCard[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return; }

    const { data: prof } = await (supabase as any)
      .from("profiles")
      .select("display_name, onboarded_at, plan")
      .eq("id", u.user.id)
      .maybeSingle();

    if (!prof?.onboarded_at) {
      navigate({ to: "/onboarding" });
      return;
    }
    setProfile({
      display_name: prof.display_name,
      plan: ((prof as any).plan ?? DEFAULT_PLAN) as AccountPlan,
    });

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    setIsAdmin((roles ?? []).some((r: any) => r.role === "superadmin"));

    const { data: mems } = await supabase
      .from("workspace_members")
      .select("role, workspace_id, workspaces:workspace_id ( id, name, description, cover_url, tier )")
      .eq("user_id", u.user.id);

    const baseCards = (mems ?? [])
      .map((m: any) => m.workspaces ? {
        id: m.workspaces.id,
        name: m.workspaces.name,
        description: m.workspaces.description,
        cover_url: m.workspaces.cover_url,
        role: m.role,
        tier: m.workspaces.tier ?? 1,
      } : null)
      .filter(Boolean) as Omit<WorkspaceCard, "previewUrl">[];

    // Busca temas escolhidos por workspace pra montar a prévia visual do mapa.
    const ids = baseCards.map((c) => c.id);
    const overridesById = new Map<string, any>();
    if (ids.length) {
      const { data: ov } = await supabase
        .from("map_overrides")
        .select("workspace_id, data")
        .in("workspace_id", ids);
      (ov ?? []).forEach((row: any) => overridesById.set(row.workspace_id, row.data));
    }

    const resolvePreview = (id: string, tier: number): string | null => {
      const data = overridesById.get(id);
      const themeId: string = data?.theme ?? getTierCaps(tier).defaultThemeId ?? DEFAULT_THEME_ID;
      if (themeId === CUSTOM_THEME_ID && data?.customTheme?.url) return data.customTheme.url;
      const theme = OFFICE_THEMES.find((t) => t.id === themeId);
      return theme?.url ?? null;
    };

    const cards: WorkspaceCard[] = baseCards.map((c) => ({
      ...c,
      previewUrl: resolvePreview(c.id, c.tier),
    }));
    setWorkspaces(cards);

    const { data: inv } = await supabase
      .from("workspace_invites")
      .select("id, token, role, workspace_id, workspaces:workspace_id ( name, description )")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());
    setInvites((inv ?? []) as any);

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const acceptInvite = async (token: string) => {
    setBusyToken(token);
    const { data, error } = await supabase.rpc("workspace_accept_invite", { _token: token });
    setBusyToken(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Convite aceito!");
    if (data) {
      try { localStorage.setItem("lastWorkspaceId", data as string); } catch {}
      navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: data as string } });
    } else {
      load();
    }
  };

  const enter = (id: string) => {
    try { localStorage.setItem("lastWorkspaceId", id); } catch {}
    navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: id } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <VersionBadge />
      <div className="max-w-5xl mx-auto px-6 py-12">
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
              <span className="text-primary-foreground font-bold">P</span>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Virtual Office</div>
              <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                <span>Olá, {profile?.display_name ?? "—"} 👋</span>
                {profile && (
                  <span
                    title={getPlanInfo(profile.plan).description}
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${getPlanInfo(profile.plan).badgeClass}`}
                  >
                    {getPlanInfo(profile.plan).shortLabel}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="text-xs text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1.5"
          >
            <LogOut size={14} /> Sair da conta
          </button>
        </header>

        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Seus espaços</h1>
            <p className="text-sm text-muted-foreground">
              Escolha um espaço para entrar. Cada espaço tem seu próprio mapa, equipe e reuniões.
            </p>
          </div>
          {isAdmin && (
            <Link
              to="/admin"
              className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 shadow-glow"
            >
              <Plus size={14} /> Painel Admin
            </Link>
          )}
        </div>

        {invites.length > 0 && (
          <section className="mb-8">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Mail size={14} /> Convites pendentes
            </div>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.id} className="glass-panel rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{inv.workspaces?.name ?? "Espaço"}</div>
                    <div className="text-xs text-muted-foreground">
                      Você foi convidado como {inv.role}.
                    </div>
                  </div>
                  <button
                    onClick={() => acceptInvite(inv.token)}
                    disabled={busyToken === inv.token}
                    className="px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {busyToken === inv.token ? "Aceitando…" : "Aceitar"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando seus espaços…</div>
        ) : workspaces.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <Sparkles className="mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-medium mb-1">Nenhum espaço por enquanto</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Você ainda não foi adicionado a nenhum espaço. Peça um convite ao administrador
              para entrar em um espaço de trabalho.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => enter(ws.id)}
                className="group text-left glass-panel rounded-2xl overflow-hidden hover:shadow-soft transition-all border border-transparent hover:border-primary/30"
              >
                <div className="relative aspect-[16/9] w-full bg-muted overflow-hidden">
                  {ws.previewUrl ? (
                    <img
                      src={ws.previewUrl}
                      alt={`Prévia do mapa de ${ws.name}`}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-primary/5">
                      <Building2 className="text-primary/40" size={40} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                  <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-white/90 bg-black/40 backdrop-blur px-2 py-1 rounded-full">
                      {ws.role}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider bg-primary/90 text-primary-foreground px-2 py-1 rounded-full font-medium">
                      Nível {ws.tier}
                    </span>
                  </div>
                  {ws.cover_url && (
                    <div className="absolute bottom-3 left-3 w-10 h-10 rounded-lg overflow-hidden ring-2 ring-white/80 shadow">
                      <img src={ws.cover_url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="font-semibold text-lg mb-1">{ws.name}</div>
                  {ws.description && (
                    <div className="text-sm text-muted-foreground mb-3 line-clamp-2">{ws.description}</div>
                  )}
                  <div className="text-xs text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                    Entrar no espaço <ArrowRight size={12} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
