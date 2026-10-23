import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SPRITES } from "@/lib/sprite-catalog";
import { SpritePreview } from "@/components/profile/SpritePreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCoarsePointer } from "@/lib/mobile/input-mode";

export const Route = createFileRoute("/visit/$token")({
  head: () => ({
    meta: [
      { title: "Visita ao Prestativa Office" },
      { name: "description", content: "Acesso temporário de visitante ao escritório virtual da Prestativa." },
      { property: "og:title", content: "Visita ao Prestativa Office" },
      { property: "og:description", content: "Acesso temporário de visitante ao escritório virtual da Prestativa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  ssr: false,
  component: VisitPage,
});

type Peek =
  | { status: "invalid" | "revoked" | "used" | "expired" }
  | { status: "scheduled"; starts_at: string }
  | { status: "mine"; workspace_id: string; expires_at: string }
  | { status: "valid"; starts_at: string; expires_at: string; intended_name: string | null; workspace_name: string | null; inviter_name: string | null };

const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-gradient-to-br from-background via-accent/30 to-background">
      <div className="w-full max-w-md text-center glass-panel rounded-2xl p-8">{children}</div>
    </div>
  );
}

function VisitPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const coarse = useCoarsePointer();
  const [peek, setPeek] = useState<Peek | null>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sprite, setSprite] = useState(SPRITES[0]?.id ?? "marcio");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("visitor_peek", { _token: token });
      if (error || !data) { setPeek({ status: "invalid" }); return; }
      const p = data as Peek;
      if (p.status === "mine") { navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: p.workspace_id }, replace: true }); return; }
      if (p.status === "valid" && p.intended_name) setName(p.intended_name);
      setPeek(p);
    })();
  }, [token, navigate]);

  const enter = async () => {
    setBusy(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      if (s.session && !s.session.user.is_anonymous) {
        setError("Você já está conectado com uma conta de colaborador. Abra este link em uma janela anônima.");
        return;
      }
      if (!s.session) {
        const { error: e } = await supabase.auth.signInAnonymously();
        if (e) throw e;
      }
      const { data: ws, error: e2 } = await supabase.rpc("visitor_activate", { _token: token, _name: name.trim(), _sprite_id: sprite });
      if (e2 || !ws) {
        const again = await supabase.rpc("visitor_peek", { _token: token });
        setPeek((again.data as Peek) ?? { status: "invalid" });
        return;
      }
      navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: ws as string }, replace: true });
    } catch {
      setError("Não foi possível entrar agora. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  };

  if (!peek) return <Shell><p className="text-sm text-muted-foreground">Verificando convite…</p></Shell>;
  if (peek.status === "scheduled") return <Shell>
    <h1 className="text-xl font-semibold mb-2">Seu convite ainda não está disponível</h1>
    <p className="text-sm text-muted-foreground">Seu acesso ao Prestativa Office estará disponível a partir de {fmt(peek.starts_at)}.</p>
  </Shell>;
  if (peek.status === "expired") return <Shell>
    <h1 className="text-xl font-semibold mb-2">Sua visita ao Prestativa Office terminou</h1>
    <p className="text-sm text-muted-foreground">Este acesso temporário expirou. Para visitar novamente, entre em contato com a Prestativa e solicite um novo convite.</p>
  </Shell>;
  if (peek.status === "revoked" || peek.status === "invalid") return <Shell>
    <h1 className="text-xl font-semibold">Este convite não está mais disponível.</h1>
  </Shell>;
  if (peek.status === "used") return <Shell>
    <h1 className="text-xl font-semibold">Este convite já foi utilizado.</h1>
  </Shell>;
  if (peek.status !== "valid") return null;

  return (
    <Shell>
      {step === 0 && <>
        <h1 className="text-2xl font-semibold mb-2">Bem-vindo ao Prestativa Office</h1>
        {peek.workspace_name && <p className="text-sm mb-1">Espaço: <strong>{peek.workspace_name}</strong></p>}
        {peek.inviter_name && <p className="text-sm text-muted-foreground mb-1">Convite de {peek.inviter_name}</p>}
        <p className="text-xs text-muted-foreground mb-6">Acesso até {fmt(peek.expires_at)}</p>
        <Button onClick={() => setStep(1)}>Começar</Button>
      </>}
      {step === 1 && <>
        <h1 className="text-xl font-semibold mb-4">Como você quer ser chamado?</h1>
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" autoFocus />
        <Button className="mt-4" disabled={!name.trim()} onClick={() => setStep(2)}>Continuar</Button>
      </>}
      {step === 2 && <>
        <h1 className="text-xl font-semibold mb-4">Escolha seu personagem</h1>
        <div className="grid grid-cols-3 gap-2 max-h-[50dvh] overflow-y-auto">
          {SPRITES.filter((s) => !s.variant).map((s) => (
            <button key={s.id} type="button" onClick={() => setSprite(s.id)}
              className={`rounded-xl border-2 p-1 flex flex-col items-center ${sprite === s.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}>
              <SpritePreview spriteId={s.id} animate={sprite === s.id} size={72} />
              <span className="text-[11px] mt-1">{s.label}</span>
            </button>
          ))}
        </div>
        <Button className="mt-4" onClick={() => setStep(3)}>Continuar</Button>
      </>}
      {step === 3 && <>
        <h1 className="text-xl font-semibold mb-3">Tudo pronto, {name.trim()}!</h1>
        <p className="text-sm mb-2">{coarse ? "Toque duas vezes no chão para caminhar." : "Use WASD ou as setas para caminhar."}</p>
        <p className="text-sm text-muted-foreground mb-6">Você está entrando como visitante. Chegue perto das pessoas para conversar.</p>
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        <Button disabled={busy} onClick={enter}>{busy ? "Entrando…" : "Entrar no escritório"}</Button>
      </>}
    </Shell>
  );
}
