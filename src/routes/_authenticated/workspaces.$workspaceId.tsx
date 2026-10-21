import { OfficeChat } from "@/components/chat/OfficeChat";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeScene } from "@/components/office/OfficeScene";
import { PreloadScreen } from "@/components/office/PreloadScreen";
import { supabase } from "@/integrations/supabase/client";
import { setCurrentWorkspaceId } from "@/lib/workspace/current";
import { toast } from "sonner";
import { useOfficeSession } from "@/lib/rtc/useOfficeSession";
import { officeGateView } from "@/lib/rtc/office-session-binding";
import { Button } from "@/components/ui/button";
import { MeetingsPanel } from "@/components/meetings/MeetingsPanel";
import { parseOfficePanel, type OfficePanel } from "@/lib/office/overlay";
import { useVisitWatch, VisitEndedScreen } from "@/components/visitors/VisitWatch";

export const Route = createFileRoute("/_authenticated/workspaces/$workspaceId")({
  head: () => ({
    meta: [
      { title: "Espaço — Prestativa Office" },
      { name: "description", content: "Trabalhe junto com a equipe da Prestativa em tempo real." },
    ],
  }),
  // ?panel= abre ferramentas SOBRE o Office sem remontar a cena (Back fecha o painel).
  validateSearch: (search: Record<string, unknown>): { panel?: OfficePanel } => {
    const panel = parseOfficePanel(search.panel);
    return panel ? { panel } : {};
  },
  component: WorkspaceScenePage,
});

function WorkspaceScenePage() {
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const { panel } = Route.useSearch();
  const setPanel = useCallback((p: OfficePanel | null) => {
    if (p) {
      navigate({ to: ".", search: { panel: p } });
    } else if (typeof window !== "undefined" && window.history.length > 1 && window.history.state?.__TSR_index > 0) {
      window.history.back();
    } else {
      navigate({ to: ".", search: {}, replace: true });
    }
  }, [navigate]);
  useEffect(() => {
    if (panel !== "meetings" && panel !== "chat") return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]:not([data-office-chat-panel]), [role="alertdialog"], [role="menu"]')) return;
      setPanel(null);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [panel, setPanel]);
  const [authorized, setAuthorized] = useState<null | boolean>(null);
  const [sceneHydrated, setSceneHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [audience, setAudience] = useState<"member" | "visitor">("member");
  const [isWsAdmin, setIsWsAdmin] = useState(false);
  const visit = useVisitWatch(audience === "visitor" ? workspaceId : null, userId);
  // Sessão única (RTC v2 Etapa 3B): só a sessão mais recente monta o OfficeScene.
  const { state: session, retry: retryClaim } = useOfficeSession(
    authorized ? userId : null,
    authorized ? workspaceId : null,
  );
  const gate = officeGateView(session.status);

  // Set workspace ID synchronously on mount, before scene mounts.
  // Done in render (idempotent) so first OfficeScene effects see it.
  if (authorized === null) {
    setCurrentWorkspaceId(workspaceId);
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { navigate({ to: "/auth" }); return; }

      // Visitante temporário: identidade anônima ligada a workspace_visitors (nunca membro).
      if (u.user.is_anonymous) {
        const { data: v } = await supabase
          .from("workspace_visitors")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", u.user.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (cancel) return;
        if (!v) { navigate({ to: "/visit-ended" }); return; }
        setCurrentWorkspaceId(workspaceId);
        setAudience("visitor");
        setUserId(u.user.id);
        setAuthorized(true);
        return;
      }

      // Onboarding gate.
      const { data: prof } = await supabase
        .from("profiles")
        .select("onboarded_at")
        .eq("id", u.user.id)
        .maybeSingle();
      if (!prof?.onboarded_at) { navigate({ to: "/onboarding" }); return; }

      // Membership check (RLS-friendly).
      const { data: mem } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (cancel) return;
      if (!mem) {
        toast.error("Você não tem acesso a este espaço.");
        navigate({ to: "/workspaces" });
        return;
      }
      setIsWsAdmin(mem.role === "owner" || mem.role === "admin");
      try { localStorage.setItem("lastWorkspaceId", workspaceId); } catch {}
      setCurrentWorkspaceId(workspaceId);
      setUserId(u.user.id);
      setAuthorized(true);
    })();
    return () => { cancel = true; };
  }, [workspaceId, navigate]);

  useEffect(() => () => { setCurrentWorkspaceId(null); }, []);

  const handleHydrated = useCallback(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setSceneHydrated(true);
  }, []);

  useEffect(() => {
    if (sceneHydrated) return;
    const id = window.setTimeout(() => setSceneHydrated(true), 8000);
    return () => window.clearTimeout(id);
  }, [sceneHydrated]);

  if (authorized !== true) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Carregando espaço…
      </div>
    );
  }

  if (visit.ended) return <VisitEndedScreen reason={visit.ended} />;

  if (gate === "replaced") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Sessão aberta em outro dispositivo</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Sua conta entrou no escritório em outro navegador ou dispositivo. Esta janela foi desconectada.
        </p>
      </div>
    );
  }

  if (gate === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Não foi possível iniciar sua sessão no escritório.</p>
        <Button onClick={retryClaim}>Tentar novamente</Button>
      </div>
    );
  }

  if (gate !== "scene") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Iniciando sessão…
      </div>
    );
  }

  const scene = (
    <>
      <div style={{ visibility: ready ? "visible" : "hidden" }}>
        <OfficeScene
          audience={audience}
          isWorkspaceAdmin={isWsAdmin}
          onHydrated={handleHydrated}
          panel={panel ?? null}
          onPanelChange={setPanel}
          rtcSession={
            session.sessionId && session.generation !== null
              ? {
                  workspaceId,
                  sessionId: session.sessionId,
                  generation: session.generation,
                  active: session.status === "ACTIVE",
                }
              : null
          }
        />
      </div>
      {audience === "member" && panel === "meetings" && (
        <div data-office-meetings-panel className="fixed inset-0 z-[300] flex items-center justify-center bg-background/40 backdrop-blur-sm p-4">
          <div className="w-full h-full max-w-7xl rounded-2xl overflow-hidden border shadow-2xl bg-background">
            <MeetingsPanel embedded onBack={() => setPanel(null)} />
          </div>
        </div>
      )}
      {!ready && (
        <PreloadScreen
          canFinish={sceneHydrated}
          onReady={() => setReady(true)}
        />
      )}
    </>
  );
  // Visitante não entra no Chat 1:1 (V1).
  if (audience === "visitor") return scene;
  return (
    <OfficeChat workspaceId={workspaceId} userId={userId!} panel={panel ?? null} onPanelChange={setPanel}>
      {scene}
    </OfficeChat>
  );
}
