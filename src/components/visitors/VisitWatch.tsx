import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type VisitEndReason = "expired" | "revoked";

/**
 * Acompanha a visita ativa: o banco (expires_at/revoked_at) é a autoridade.
 * Timer local só antecipa a UX; Realtime + checagem periódica refletem extensão/encerramento.
 */
export function useVisitWatch(workspaceId: string | null, userId: string | null) {
  const [ended, setEnded] = useState<VisitEndReason | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    let timer: number | undefined;

    const apply = (row: { expires_at: string; revoked_at: string | null } | null) => {
      if (cancelled) return;
      if (!row) { setEnded("revoked"); return; }
      if (row.revoked_at) { setEnded("revoked"); return; }
      const ms = Date.parse(row.expires_at) - Date.now();
      if (ms <= 0) { setEnded("expired"); return; }
      setExpiresAt(row.expires_at);
      if (timer) window.clearTimeout(timer);
      // setTimeout aceita no máximo ~24,8 dias; rechecamos antes disso.
      timer = window.setTimeout(() => void check(), Math.min(ms + 500, 2 ** 31 - 1));
    };

    const check = async () => {
      const { data, error } = await supabase
        .from("workspace_visitors")
        .select("expires_at, revoked_at")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return; // falha transitória: o servidor segue negando acessos inválidos
      apply(data);
    };

    void check();
    const poll = window.setInterval(() => void check(), 60_000);
    const ch = supabase
      .channel(`visit-watch:${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspace_visitors", filter: `user_id=eq.${userId}` },
        (payload) => apply(payload.new as { expires_at: string; revoked_at: string | null }))
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(ch);
    };
  }, [workspaceId, userId]);

  return { ended, expiresAt };
}

export function VisitEndedScreen({ reason }: { reason: VisitEndReason }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center glass-panel rounded-2xl p-10">
        {reason === "revoked" ? (
          <>
            <h1 className="text-xl font-semibold mb-2">Sua visita foi encerrada.</h1>
            <p className="text-sm text-muted-foreground">Obrigado por visitar o Prestativa Office.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold mb-2">Sua visita ao Prestativa Office terminou</h1>
            <p className="text-sm text-muted-foreground">
              Este acesso temporário expirou. Para visitar novamente, entre em contato com a Prestativa e solicite um novo convite.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
