import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publicAppBaseUrl } from "@/lib/invites";
import { VISIT_DURATIONS, VISIT_EXTENSIONS_HOURS, computeVisitWindow, extendedExpiry } from "@/lib/visitors/schedule";
import { visitPhase, type VisitPhase } from "@/lib/visitors/capabilities";

type Row = {
  id: string; name: string | null; starts_at: string; expires_at: string;
  activated_at: string | null; revoked_at: string | null; inviter_name: string | null;
};
const fmt = (iso: string | Date) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const PHASE_LABEL: Record<VisitPhase, string> = { scheduled: "Agendados", waiting: "Aguardando", active: "Ativos", ended: "Encerrados" };

export function VisitorsButton({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  if (!workspaceId) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Convidar visitante" aria-label="Convidar visitante"
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition">
        <UserPlus className="w-4 h-4" />
      </button>
      {open && <VisitorsDialog workspaceId={workspaceId} onClose={() => setOpen(false)} />}
    </>
  );
}

function VisitorsDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [tab, setTab] = useState("invite");
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("visitor_list", { ws: workspaceId });
    if (!error) setRows((data as Row[]) ?? []);
  }, [workspaceId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg z-[400]" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader><DialogTitle>Convidar visitante</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full"><TabsTrigger value="invite" className="flex-1">Novo convite</TabsTrigger><TabsTrigger value="list" className="flex-1">Visitantes</TabsTrigger></TabsList>
          <TabsContent value="invite"><InviteForm workspaceId={workspaceId} onCreated={load} /></TabsContent>
          <TabsContent value="list"><VisitorList rows={rows} reload={load} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [startNow, setStartNow] = useState(true);
  const [startAt, setStartAt] = useState(() => toLocalInput(new Date()));
  const [hours, setHours] = useState<number | "custom">(4);
  const [customEnd, setCustomEnd] = useState(() => toLocalInput(new Date(Date.now() + 86_400_000)));
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const window_ = useMemo(() => {
    const start = startNow ? new Date() : new Date(startAt);
    return computeVisitWindow(start, hours === "custom" ? { customEnd: new Date(customEnd) } : { hours });
  }, [startNow, startAt, hours, customEnd]);

  const create = async () => {
    if (!window_) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("visitor_create_invite", {
      ws: workspaceId, _name: name, _starts_at: startNow ? new Date().toISOString() : window_.startsAt.toISOString(),
      _expires_at: window_.expiresAt.toISOString(),
    });
    setBusy(false);
    if (error || !data) { toast.error("Não foi possível gerar o convite."); return; }
    setLink(`${publicAppBaseUrl()}/visit/${(data as { token: string }).token}`);
    onCreated();
  };

  if (link) return (
    <div className="space-y-3 pt-2">
      <p className="text-sm">Link gerado. Copie agora — ele não poderá ser exibido de novo.</p>
      <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado."); }}><Copy className="w-4 h-4 mr-1" />Copiar link</Button></div>
      <Button variant="ghost" onClick={() => { setLink(null); setName(""); }}>Gerar outro</Button>
    </div>
  );

  return (
    <div className="space-y-3 pt-2 text-sm">
      <label className="block">Nome do visitante (opcional)<Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <div>Início do acesso
        <div className="flex gap-2 mt-1">
          <Button size="sm" variant={startNow ? "default" : "outline"} onClick={() => setStartNow(true)}>Agora</Button>
          <Button size="sm" variant={!startNow ? "default" : "outline"} onClick={() => setStartNow(false)}>Data e hora</Button>
        </div>
        {!startNow && <Input className="mt-2" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
      </div>
      <div>Duração
        <div className="flex flex-wrap gap-1 mt-1">
          {VISIT_DURATIONS.map((d) => <Button key={d.hours} size="sm" variant={hours === d.hours ? "default" : "outline"} onClick={() => setHours(d.hours)}>{d.label}</Button>)}
          <Button size="sm" variant={hours === "custom" ? "default" : "outline"} onClick={() => setHours("custom")}>Personalizado</Button>
        </div>
        {hours === "custom" && <Input className="mt-2" type="datetime-local" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />}
      </div>
      <p className="text-muted-foreground">{window_ ? `Acesso válido de ${fmt(window_.startsAt)} até ${fmt(window_.expiresAt)}` : "Escolha um término depois do início."}</p>
      <Button className="w-full" disabled={!window_ || busy} onClick={create}>Gerar link de visita</Button>
    </div>
  );
}

function VisitorList({ rows, reload }: { rows: Row[]; reload: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customVal, setCustomVal] = useState("");
  const groups = (["active", "waiting", "scheduled", "ended"] as VisitPhase[]).map((ph) => ({ ph, items: rows.filter((r) => visitPhase(r, now) === ph) }));

  const extend = async (r: Row, to: Date | null) => {
    if (!to) { toast.error("Essa visita já terminou. Gere um novo convite."); return; }
    const { error } = await supabase.rpc("visitor_extend", { _invite_id: r.id, _expires_at: to.toISOString() });
    if (error) toast.error("Não foi possível estender."); else { toast.success(`Visita até ${fmt(to)}.`); reload(); }
  };
  const revoke = async (r: Row) => {
    if (!window.confirm(`Encerrar a visita de ${r.name ?? "visitante"}?`)) return;
    const { error } = await supabase.rpc("visitor_revoke", { _invite_id: r.id });
    if (error) toast.error("Não foi possível encerrar."); else { toast.success("Visita encerrada."); reload(); }
  };

  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">Nenhum visitante ainda.</p>;
  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pt-2">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.ph}>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{PHASE_LABEL[g.ph]}</div>
          {g.items.map((r) => (
            <div key={r.id} className="border rounded-lg p-2 mb-2 text-sm">
              <div className="font-medium">{r.name ?? "Visitante sem nome"}</div>
              <div className="text-xs text-muted-foreground">{fmt(r.starts_at)} → {fmt(r.expires_at)}{r.inviter_name ? ` · por ${r.inviter_name}` : ""}{r.revoked_at ? " · encerrada" : ""}</div>
              {g.ph !== "ended" && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {VISIT_EXTENSIONS_HOURS.map((h) => <Button key={h} size="sm" variant="outline" onClick={() => extend(r, extendedExpiry(r.expires_at, h))}>+{h}h</Button>)}
                  <Button size="sm" variant="outline" onClick={() => { setCustomFor(r.id); setCustomVal(toLocalInput(new Date(r.expires_at))); }}>Escolher nova data</Button>
                  <Button size="sm" variant="destructive" onClick={() => revoke(r)}>Encerrar visita</Button>
                </div>
              )}
              {customFor === r.id && (
                <div className="flex gap-2 mt-2">
                  <Input type="datetime-local" value={customVal} onChange={(e) => setCustomVal(e.target.value)} />
                  <Button size="sm" onClick={() => { setCustomFor(null); void extend(r, new Date(customVal)); }}>Salvar</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
