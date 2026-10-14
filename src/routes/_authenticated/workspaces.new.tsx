import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OFFICE_THEMES } from "@/lib/office-themes";
import { TIERS, type WorkspaceTier, getTierCaps, isUnlimited } from "@/lib/workspace/tiers";
import { useMyPlan } from "@/lib/account/useMyPlan";
import { allowedTiersForPlan, getPlanInfo } from "@/lib/account/plans";
import {
  createWorkspace,
  suggestSlug,
  type SeedSource,
} from "@/lib/workspace/create";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  Loader2,
  Building2,
  Palette,
  Map as MapIcon,
  ClipboardCheck,
  Upload,
  X as XIcon,
  Layers,
  Users,
  Video,
  Sparkle,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspaces/new")({
  head: () => ({ meta: [{ title: "Novo espaço — Prestativa Office" }] }),
  component: NewWorkspacePage,
});

type Step = 1 | 2 | 3 | 4 | 5;

function NewWorkspacePage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const { plan, info: planInfo, loading: planLoading } = useMyPlan();
  const allowedTiers = useMemo(() => allowedTiersForPlan(plan), [plan]);

  const [step, setStep] = useState<Step>(1);
  const [tier, setTier] = useState<WorkspaceTier>(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [themeId, setThemeId] = useState<string>("nivel-1");
  const [customThemeUrl, setCustomThemeUrl] = useState<string | null>(null);
  const [customThemeLabel, setCustomThemeLabel] = useState<string>("");
  const [seedFrom, setSeedFrom] = useState<SeedSource>("blank");
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Caps do tier escolhido
  const caps = useMemo(() => getTierCaps(tier), [tier]);

  // Se o tier atual não cabe no plano da conta, força o maior tier permitido.
  useEffect(() => {
    if (planLoading) return;
    if (!allowedTiers.includes(tier)) {
      setTier(planInfo.maxTier);
    }
  }, [planLoading, allowedTiers, tier, planInfo.maxTier]);

  // Quando o tier muda, propõe o tema-padrão dele.
  useEffect(() => {
    if (caps.defaultThemeId) {
      setThemeId(caps.defaultThemeId);
      setCustomThemeUrl(null);
      setCustomThemeLabel("");
    }
  }, [tier]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/auth" });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id);
      const isAdmin = (roles ?? []).some((r: any) => r.role === "superadmin" || r.role === "admin");
      setAllowed(isAdmin);
      try {
        const last = localStorage.getItem("lastWorkspaceId");
        if (last) setSourceWorkspaceId(last);
      } catch {}
      setChecking(false);
    })();
  }, [navigate]);

  useEffect(() => {
    if (!slugTouched) setSlug(name ? suggestSlug(name) : "");
  }, [name, slugTouched]);

  // Temas disponíveis no tier escolhido
  const availableThemes = useMemo(
    () => OFFICE_THEMES.filter((t) => (t.minTier ?? 1) === tier),
    [tier]
  );

  const selectedTheme = useMemo(() => {
    if (themeId === "custom" && customThemeUrl) {
      return {
        id: "custom",
        label: customThemeLabel || "Tema personalizado",
        url: customThemeUrl,
      };
    }
    return availableThemes.find((t) => t.id === themeId) ?? availableThemes[0] ?? OFFICE_THEMES[0];
  }, [themeId, customThemeUrl, customThemeLabel, availableThemes]);

  useEffect(() => {
    if (themeId === "custom") return;
    if (!availableThemes.some((t) => t.id === themeId)) {
      setThemeId(availableThemes[0]?.id ?? "nivel-1");
    }
  }, [availableThemes, themeId]);

  const canNext = useMemo(() => {
    if (step === 1) return true; // tier sempre selecionado
    if (step === 2) return name.trim().length >= 2 && slug.trim().length >= 2;
    if (step === 3 && themeId === "custom" && !customThemeUrl) return false;
    if (step === 4 && seedFrom === "current" && !sourceWorkspaceId) return false;
    return true;
  }, [step, name, slug, themeId, customThemeUrl, seedFrom, sourceWorkspaceId]);

  const submit = async () => {
    setSubmitting(true);
    const result = await createWorkspace({
      name,
      slug,
      description: description || null,
      themeId,
      customThemeUrl: themeId === "custom" ? customThemeUrl : null,
      customThemeLabel: themeId === "custom" ? customThemeLabel || "Tema personalizado" : null,
      seedFrom,
      sourceWorkspaceId,
      tier,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Espaço criado!");
    try {
      localStorage.setItem("lastWorkspaceId", result.workspaceId);
    } catch {}
    navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: result.workspaceId },
    });
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background flex items-center justify-center px-6">
        <div className="glass-panel rounded-2xl p-8 max-w-md text-center">
          <Sparkles className="mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-lg font-semibold mb-1">Sem permissão</h1>
          <p className="text-sm text-muted-foreground mb-5">
            Só administradores podem criar novos espaços.
          </p>
          <button
            onClick={() => navigate({ to: "/workspaces" })}
            className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <button
          onClick={() => navigate({ to: "/workspaces" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6"
        >
          <ArrowLeft size={14} /> Voltar para Seus espaços
        </button>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Novo espaço
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Configure um novo espaço sem afetar o espaço atual. Cada
          espaço tem seu próprio nível, mapa, tema, áreas e equipe.
        </p>

        <Stepper step={step} />

        <div className="glass-panel rounded-2xl p-6 mt-6">
          {step === 1 && (
            <StepTier
              tier={tier}
              setTier={setTier}
              allowedTiers={allowedTiers}
              planLabel={planInfo.label}
              planDescription={planInfo.description}
            />
          )}
          {step === 2 && (
            <StepIdentity
              name={name}
              setName={setName}
              slug={slug}
              setSlug={(v) => {
                setSlugTouched(true);
                setSlug(v);
              }}
              description={description}
              setDescription={setDescription}
            />
          )}
          {step === 3 && (
            <StepTheme
              themeId={themeId}
              setThemeId={setThemeId}
              customThemeUrl={customThemeUrl}
              setCustomThemeUrl={setCustomThemeUrl}
              customThemeLabel={customThemeLabel}
              setCustomThemeLabel={setCustomThemeLabel}
              availableThemes={availableThemes}
              canUploadCustom={caps.canUploadCustomTheme}
            />
          )}
          {step === 4 && (
            <StepSeed
              seedFrom={seedFrom}
              setSeedFrom={setSeedFrom}
              hasSource={!!sourceWorkspaceId}
            />
          )}
          {step === 5 && (
            <StepReview
              name={name}
              slug={slug}
              description={description}
              theme={selectedTheme}
              seedFrom={seedFrom}
              tier={tier}
            />
          )}
        </div>

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setStep((s) => (Math.max(1, s - 1) as Step))}
            disabled={step === 1}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            Voltar
          </button>
          {step < 5 ? (
            <button
              onClick={() => setStep((s) => (Math.min(5, s + 1) as Step))}
              disabled={!canNext}
              className="px-5 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              Avançar <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Criando…
                </>
              ) : (
                <>
                  <Check size={14} /> Criar espaço
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Nível", icon: Layers },
    { n: 2, label: "Identidade", icon: Building2 },
    { n: 3, label: "Tema", icon: Palette },
    { n: 4, label: "Mapa inicial", icon: MapIcon },
    { n: 5, label: "Revisão", icon: ClipboardCheck },
  ];
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {steps.map((s, i) => {
        const active = step === s.n;
        const done = step > s.n;
        const Icon = s.icon;
        return (
          <div key={s.n} className="flex items-center gap-2 flex-1 min-w-fit">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon size={14} /> {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 ${done ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepTier({
  tier,
  setTier,
  allowedTiers,
  planLabel,
  planDescription,
}: {
  tier: WorkspaceTier;
  setTier: (t: WorkspaceTier) => void;
  allowedTiers: WorkspaceTier[];
  planLabel: string;
  planDescription: string;
}) {
  const tiers: WorkspaceTier[] = [1, 2, 3];
  return (
    <div>
      <div className="mb-4 rounded-xl bg-primary/5 border border-primary/20 p-3">
        <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">
          Sua conta · {planLabel}
        </div>
        <div className="text-xs text-muted-foreground">{planDescription}</div>
      </div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
        Escolha o nível do espaço
      </div>
      <div className="grid gap-3">
        {tiers.map((t) => {
          const caps = TIERS[t];
          const active = t === tier;
          const isAllowed = allowedTiers.includes(t);
          return (
            <button
              key={t}
              onClick={() => isAllowed && setTier(t)}
              disabled={!isAllowed}
              title={isAllowed ? undefined : `Disponível em planos superiores ao ${planLabel}.`}
              className={`text-left rounded-xl p-4 border-2 transition ${
                active
                  ? "border-primary bg-primary/5 shadow-glow"
                  : isAllowed
                  ? "border-border hover:border-primary/40"
                  : "border-border opacity-50 cursor-not-allowed"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-semibold text-base flex items-center gap-2">
                    {caps.label}
                    {!isAllowed && (
                      <span className="text-[10px] uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                        Upgrade necessário
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {caps.description}
                  </div>
                </div>
                {active && (
                  <div className="rounded-full bg-primary text-primary-foreground p-1">
                    <Check size={12} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Cap
                  icon={<Users size={12} />}
                  label="Membros"
                  value={isUnlimited(caps.maxMembers) ? "Ilimitado" : `Até ${caps.maxMembers}`}
                />
                <Cap
                  icon={<Video size={12} />}
                  label="Reuniões A/V"
                  value={caps.canMeetingAV ? "Sim" : "Não"}
                  dim={!caps.canMeetingAV}
                />
                <Cap
                  icon={<Sparkle size={12} />}
                  label="Gravação + IA"
                  value={caps.canRecordMeetings ? "Sim" : "Não"}
                  dim={!caps.canRecordMeetings}
                />
                <Cap
                  icon={<ShieldCheck size={12} />}
                  label="Teleporte"
                  value={caps.canTeleport ? "Sim" : "Não"}
                  dim={!caps.canTeleport}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Cap({
  icon,
  label,
  value,
  dim,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-background/50 ${
        dim ? "text-muted-foreground/60" : "text-foreground"
      }`}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StepIdentity({
  name,
  setName,
  slug,
  setSlug,
  description,
  setDescription,
}: {
  name: string;
  setName: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Nome do espaço
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Prestativa SP"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Identificador (slug)
        </label>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="prestativa-sp"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Descrição (opcional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Para que serve este espaço?"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
        />
      </div>
    </div>
  );
}

function StepTheme({
  themeId,
  setThemeId,
  customThemeUrl,
  setCustomThemeUrl,
  customThemeLabel,
  setCustomThemeLabel,
  availableThemes,
  canUploadCustom,
}: {
  themeId: string;
  setThemeId: (id: string) => void;
  customThemeUrl: string | null;
  setCustomThemeUrl: (u: string | null) => void;
  customThemeLabel: string;
  setCustomThemeLabel: (s: string) => void;
  availableThemes: typeof OFFICE_THEMES;
  canUploadCustom: boolean;
}) {
  const [uploading, setUploading] = useState(false);

  const onUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 8MB).");
      return;
    }
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? "anon";
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("office-theme-bg")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) {
        toast.error(error.message);
        return;
      }
      const { data: pub } = supabase.storage.from("office-theme-bg").getPublicUrl(path);
      setCustomThemeUrl(pub.publicUrl);
      if (!customThemeLabel) setCustomThemeLabel(file.name.replace(/\.[^.]+$/, ""));
      setThemeId("custom");
      toast.success("Imagem enviada!");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
        Escolha o tema visual
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {availableThemes.map((t) => {
          const active = t.id === themeId;
          return (
            <button
              key={t.id}
              onClick={() => setThemeId(t.id)}
              className={`text-left rounded-xl overflow-hidden border-2 transition ${
                active
                  ? "border-primary shadow-glow"
                  : "border-transparent hover:border-primary/40"
              }`}
            >
              <div className="aspect-video bg-muted">
                <img src={t.url} alt={t.label} className="w-full h-full object-cover" />
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-sm">{t.label}</div>
                  {active && <Check size={14} className="text-primary" />}
                </div>
                {t.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {t.description}
                  </div>
                )}
              </div>
            </button>
          );
        })}

        {canUploadCustom && (
          <label
            className={`text-left rounded-xl overflow-hidden border-2 transition cursor-pointer block ${
              themeId === "custom"
                ? "border-primary shadow-glow"
                : "border-dashed border-border hover:border-primary/40"
            }`}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
            <div className="aspect-video bg-muted flex items-center justify-center relative">
              {customThemeUrl ? (
                <img src={customThemeUrl} alt="Tema personalizado" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-muted-foreground text-xs gap-1">
                  {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                  <span>{uploading ? "Enviando…" : "Enviar nova imagem"}</span>
                </div>
              )}
              {customThemeUrl && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCustomThemeUrl(null);
                    setCustomThemeLabel("");
                    if (themeId === "custom") setThemeId(availableThemes[0]?.id ?? "nivel-1");
                  }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-background"
                  aria-label="Remover imagem"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-sm">
                  {customThemeUrl ? (
                    <input
                      type="text"
                      value={customThemeLabel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setCustomThemeLabel(e.target.value)}
                      placeholder="Nome do tema"
                      className="bg-transparent border-b border-border focus:outline-none focus:border-primary text-sm w-full"
                    />
                  ) : (
                    "Tema personalizado"
                  )}
                </div>
                {themeId === "custom" && <Check size={14} className="text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">
                Envie uma imagem (PNG/JPG) e use como fundo do mapa.
              </div>
            </div>
          </label>
        )}

        {!canUploadCustom && (
          <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground flex items-center justify-center text-center">
            Upload de tema customizado disponível apenas no Nível 3.
          </div>
        )}
      </div>
    </div>
  );
}

function StepSeed({
  seedFrom,
  setSeedFrom,
  hasSource,
}: {
  seedFrom: SeedSource;
  setSeedFrom: (s: SeedSource) => void;
  hasSource: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Ponto de partida do mapa
      </div>
      <button
        onClick={() => setSeedFrom("blank")}
        className={`w-full text-left rounded-xl p-4 border-2 transition ${
          seedFrom === "blank"
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40"
        }`}
      >
        <div className="font-medium text-sm mb-1">Começar em branco</div>
        <div className="text-xs text-muted-foreground">
          Mapa vazio. O admin pode pintar áreas, paredes e props depois no Editor de Espaço.
        </div>
      </button>
      <button
        onClick={() => setSeedFrom("current")}
        disabled={!hasSource}
        className={`w-full text-left rounded-xl p-4 border-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${
          seedFrom === "current"
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40"
        }`}
      >
        <div className="font-medium text-sm mb-1">Copiar do espaço atual</div>
        <div className="text-xs text-muted-foreground">
          {hasSource
            ? "Clona zonas, paredes, props e custom props do último espaço acessado."
            : "Nenhum espaço de origem detectado."}
        </div>
      </button>
    </div>
  );
}

function StepReview({
  name,
  slug,
  description,
  theme,
  seedFrom,
  tier,
}: {
  name: string;
  slug: string;
  description: string;
  theme: { label: string; url: string };
  seedFrom: SeedSource;
  tier: WorkspaceTier;
}) {
  const caps = getTierCaps(tier);
  return (
    <div className="space-y-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Revisão
      </div>
      <div className="rounded-xl overflow-hidden border border-border">
        <img src={theme.url} alt={theme.label} className="w-full aspect-video object-cover" />
        <div className="p-4 bg-background/50">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">{name || "(sem nome)"}</div>
            <div className="text-[10px] uppercase tracking-wider bg-primary/15 text-primary px-2 py-1 rounded-full">
              {caps.shortLabel}
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-mono mb-1">/{slug}</div>
          {description && (
            <div className="text-sm text-muted-foreground mb-2">{description}</div>
          )}
          <div className="text-xs text-muted-foreground">
            Tema: <b>{theme.label}</b> · Mapa: <b>{seedFrom === "blank" ? "em branco" : "copiado do atual"}</b>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Limites: {isUnlimited(caps.maxMembers) ? "membros ilimitados" : `até ${caps.maxMembers} membros`}
            {caps.canMeetingAV ? " · A/V liberado" : " · sem A/V"}
            {caps.canRecordMeetings ? " · gravação + IA" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
