import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Users, Clock, Video, Sparkles, Loader2, FileText, ChevronDown,
  Folder, FolderPlus, FolderOpen, Inbox, Pencil, Trash2, FolderInput,
  Search, Star, Download, Check, X, AlertCircle, CheckCircle2, Send, Mail,
} from "lucide-react";
import { generateMeetingAi } from "@/lib/meetings/ai.functions";
import { getRecordingUrl, deleteMeeting } from "@/lib/meetings/recording.functions";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UNDO_WINDOW_MS, accessBadge, buildAccessMap, validSelection, type AccessKind, canSubmitSelection, confirmQuestion, selectionLabel, sentToast } from "@/lib/meetings/share-flow";
import { appPrompt, appConfirm } from "@/components/ui/app-dialogs";


type MeetingRow = {
  id: string;
  workspace_id: string;
  zone_id: string;
  zone_label: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  host_id: string | null;
  recording_path: string | null;
  recording_started_at?: string | null;
  recorded_by?: string | null;

  recording_duration_seconds: number | null;
  transcript: string | null;
  summary: string | null;
  ai_status: string | null;
  ai_error: string | null;
};

type ParticipantRow = {
  meeting_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  profiles?: { display_name: string; avatar_color: string } | null;
};

type ShareRow = { meeting_id: string; sender_id: string };

type FolderRow = { id: string; name: string };
type FolderItemRow = { folder_id: string; meeting_id: string };

/** "all" | "unfiled" | "favorites" | "received" | uuid de pasta */
type FolderSel = "all" | "unfiled" | "favorites" | "received" | string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function MeetingsPanel({ onBack, embedded = false }: { onBack?: () => void; embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [participantsByMeeting, setParticipantsByMeeting] = useState<
    Record<string, ParticipantRow[]>
  >({});
  const [profiles, setProfiles] = useState<Record<string, { display_name: string; avatar_color: string }>>({});
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [folderItems, setFolderItems] = useState<FolderItemRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [receivedShares, setReceivedShares] = useState<Map<string, string>>(new Map()); // meeting_id -> sender_id
  const [selected, setSelected] = useState<FolderSel>("all");
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shareTarget, setShareTarget] = useState<MeetingRow | null>(null);
  const [deletable, setDeletable] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      setUserId(uid);

      const [{ data: ms }, { data: fs }, { data: fis }, { data: favs }, { data: shares }] = await Promise.all([
        supabase
          .from("meetings" as never)
          .select("id, workspace_id, zone_id, zone_label, title, started_at, ended_at, host_id, recording_path, recording_started_at, recorded_by, recording_duration_seconds, transcript, summary, ai_status, ai_error")
          .or("recording_path.not.is.null,recording_started_at.not.is.null")
          .order("started_at", { ascending: false })
          .limit(200),

        sb.from("meeting_folders").select("id, name").order("name"),
        sb.from("meeting_folder_items").select("folder_id, meeting_id"),
        sb.from("meeting_favorites").select("meeting_id"),
        uid
          ? sb.from("meeting_recording_shares").select("meeting_id, sender_id").eq("recipient_id", uid)
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      const meetingList = (ms ?? []) as MeetingRow[];
      setMeetings(meetingList);
      setFolders((fs ?? []) as FolderRow[]);
      setFolderItems((fis ?? []) as FolderItemRow[]);
      setFavorites(new Set(((favs ?? []) as { meeting_id: string }[]).map((f) => f.meeting_id)));
      const shareMap = new Map<string, string>();
      for (const s of ((shares ?? []) as ShareRow[])) shareMap.set(s.meeting_id, s.sender_id);
      setReceivedShares(shareMap);

      if (meetingList.length > 0) {
        const ids = meetingList.map((m) => m.id);
        const { data: parts } = await supabase
          .from("meeting_participants" as never)
          .select("meeting_id, user_id, joined_at, left_at")
          .in("meeting_id", ids);
        const byMeeting: Record<string, ParticipantRow[]> = {};
        for (const p of (parts ?? []) as ParticipantRow[]) {
          (byMeeting[p.meeting_id] ??= []).push(p);
        }
        setParticipantsByMeeting(byMeeting);

        // Permissão de exclusão (apenas para exibir o botão — o servidor revalida).
        if (uid) {
          const wsIds = Array.from(new Set(meetingList.map((m) => m.workspace_id)));
          const [{ data: eg }, superadmin, ...wsAdm] = await Promise.all([
            sb.from("meeting_egress").select("meeting_id, started_by").in("meeting_id", ids),
            sb.rpc("platform_is_superadmin"),
            ...wsIds.map((w) => sb.rpc("is_workspace_admin", { _workspace_id: w, _user_id: uid })),
          ]);
          const globalAdmin = superadmin.data === true;
          const adminWs = new Set(wsIds.filter((_, i) => !!wsAdm[i]?.data));
          const startedByMe = new Set(
            ((eg ?? []) as { meeting_id: string; started_by: string }[])
              .filter((e) => e.started_by === uid).map((e) => e.meeting_id),
          );
          if (!cancelled) setDeletable(new Set(meetingList.filter((m) =>
            globalAdmin || adminWs.has(m.workspace_id) || m.recorded_by === uid || startedByMe.has(m.id),
          ).map((m) => m.id)));
        }

        const userIds = Array.from(
          new Set([
            ...meetingList.map((m) => m.host_id).filter(Boolean) as string[],
            ...Array.from(shareMap.values()),
            ...((parts ?? []) as ParticipantRow[]).map((p) => p.user_id),
          ]),
        );
        if (userIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, display_name, avatar_color")
            .in("id", userIds);
          const map: Record<string, { display_name: string; avatar_color: string }> = {};
          for (const p of profs ?? []) {
            map[p.id] = { display_name: p.display_name, avatar_color: p.avatar_color };
          }
          setProfiles(map);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const foldersByMeeting = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const fi of folderItems) {
      (m[fi.meeting_id] ??= new Set()).add(fi.folder_id);
    }
    return m;
  }, [folderItems]);

  const countsByFolder = useMemo(() => {
    const c: Record<string, number> = {};
    for (const fi of folderItems) c[fi.folder_id] = (c[fi.folder_id] ?? 0) + 1;
    return c;
  }, [folderItems]);

  const unfiledCount = useMemo(
    () => meetings.filter((m) => !foldersByMeeting[m.id] || foldersByMeeting[m.id].size === 0).length,
    [meetings, foldersByMeeting],
  );

  const visibleMeetings = useMemo(() => {
    let base: MeetingRow[];
    if (selected === "all") base = meetings.filter((m) => !receivedShares.has(m.id));
    else if (selected === "received") base = meetings.filter((m) => receivedShares.has(m.id));
    else if (selected === "favorites") base = meetings.filter((m) => favorites.has(m.id));
    else if (selected === "unfiled") base = meetings.filter((m) => !receivedShares.has(m.id) && (!foldersByMeeting[m.id] || foldersByMeeting[m.id].size === 0));
    else base = meetings.filter((m) => foldersByMeeting[m.id]?.has(selected));

    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((m) => {
      const hay = [m.title ?? "", m.zone_label, m.summary ?? "", m.transcript ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [meetings, foldersByMeeting, favorites, selected, query]);

  // CRUD pastas
  const createFolder = async () => {
    const raw = await appPrompt({ title: "Nova pasta", placeholder: "Nome da pasta", confirmLabel: "Criar" });
    const name = raw?.trim();
    if (!name || !userId) return;
    const { data, error } = await sb
      .from("meeting_folders")
      .insert({ user_id: userId, name })
      .select("id, name")
      .single();
    if (error) { toast.error(error.message); return; }
    setFolders((prev) => [...prev, data as FolderRow].sort((a, b) => a.name.localeCompare(b.name)));
    setSelected((data as FolderRow).id);
  };

  const renameFolder = async (f: FolderRow) => {
    const raw = await appPrompt({ title: "Renomear pasta", defaultValue: f.name, placeholder: "Novo nome" });
    const name = raw?.trim();
    if (!name || name === f.name) return;
    const { error } = await sb.from("meeting_folders").update({ name }).eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, name } : x)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteFolder = async (f: FolderRow) => {
    if (!(await appConfirm({ title: `Excluir "${f.name}"?`, description: "As reuniões continuam no histórico.", confirmLabel: "Excluir", destructive: true }))) return;
    const { error } = await sb.from("meeting_folders").delete().eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    setFolders((prev) => prev.filter((x) => x.id !== f.id));
    setFolderItems((prev) => prev.filter((x) => x.folder_id !== f.id));
    if (selected === f.id) setSelected("all");
  };


  const toggleMembership = async (meetingId: string, folderId: string, isMember: boolean) => {
    if (!userId) return;
    if (isMember) {
      const { error } = await sb
        .from("meeting_folder_items")
        .delete()
        .eq("meeting_id", meetingId)
        .eq("folder_id", folderId);
      if (error) return alert(error.message);
      setFolderItems((prev) => prev.filter((fi) => !(fi.meeting_id === meetingId && fi.folder_id === folderId)));
    } else {
      const { error } = await sb
        .from("meeting_folder_items")
        .insert({ user_id: userId, meeting_id: meetingId, folder_id: folderId });
      if (error) return alert(error.message);
      setFolderItems((prev) => [...prev, { folder_id: folderId, meeting_id: meetingId }]);
    }
  };

  const toggleFavorite = async (meetingId: string) => {
    if (!userId) return;
    const isFav = favorites.has(meetingId);
    if (isFav) {
      const { error } = await sb
        .from("meeting_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("meeting_id", meetingId);
      if (error) return alert(error.message);
      setFavorites((prev) => { const n = new Set(prev); n.delete(meetingId); return n; });
    } else {
      const { error } = await sb
        .from("meeting_favorites")
        .insert({ user_id: userId, meeting_id: meetingId });
      if (error) return alert(error.message);
      setFavorites((prev) => new Set(prev).add(meetingId));
    }
  };

  const renameMeeting = async (meetingId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    const { error } = await sb.rpc("meeting_set_title", {
      _meeting_id: meetingId,
      _title: trimmed,
    });
    if (error) { alert(error.message); return; }
    setMeetings((prev) =>
      prev.map((m) => (m.id === meetingId ? { ...m, title: trimmed || null } : m)),
    );
  };

  const currentTitle =
    selected === "all" ? "Minhas reuniões"
    : selected === "favorites" ? "Favoritas"
    : selected === "received" ? "Gravações recebidas"
    : selected === "unfiled" ? "Sem pasta"
    : folders.find((f) => f.id === selected)?.name ?? "Pasta";

  return (
    <div className={embedded ? "h-full overflow-y-auto bg-background" : "min-h-screen bg-background"}>
      <header className="border-b sticky top-0 bg-background/90 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (onBack) { onBack(); return; }
              const last = typeof window !== "undefined" ? window.localStorage.getItem("lastWorkspaceId") : null;
              if (last) {
                navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: last } });
              } else {
                navigate({ to: "/workspaces" });
              }
            }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            {onBack ? "Voltar ao escritório" : "Voltar ao espaço"}
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar em títulos, resumos…"
                className="pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background w-64 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="text-sm font-semibold">{currentTitle}</div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        <FolderExplorer
          folders={folders}
          selected={selected}
          onSelect={setSelected}
          allCount={meetings.filter((m) => !receivedShares.has(m.id)).length}
          favoritesCount={favorites.size}
          receivedCount={receivedShares.size}
          unfiledCount={unfiledCount}
          countsByFolder={countsByFolder}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
        />

        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : visibleMeetings.length === 0 ? (
            <EmptyState selected={selected} hasQuery={!!query.trim()} />
          ) : (
            <ul className="space-y-3">
              {visibleMeetings.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  participants={participantsByMeeting[m.id] ?? []}
                  profilesById={profiles}
                  hostProfile={m.host_id ? profiles[m.host_id] : undefined}
                  receivedFromSenderId={receivedShares.get(m.id) ?? null}
                  receivedFromProfile={(() => {
                    const sid = receivedShares.get(m.id);
                    return sid ? profiles[sid] : undefined;
                  })()}
                  folders={folders}
                  meetingFolderIds={foldersByMeeting[m.id] ?? new Set()}
                  isFavorite={favorites.has(m.id)}
                  onToggleFavorite={() => toggleFavorite(m.id)}
                  onRename={(t) => renameMeeting(m.id, t)}
                  onToggleFolder={(folderId, isMember) => toggleMembership(m.id, folderId, isMember)}
                  onCreateFolder={createFolder}
                  onShare={() => setShareTarget(m)}
                  canDelete={deletable.has(m.id)}
                  onDeleted={() => {
                    setMeetings((prev) => prev.filter((row) => row.id !== m.id));
                    setSelected("all");
                    if (!embedded) window.scrollTo({ top: 0 });
                  }}
                  onAiUpdated={(transcript, summary) => {
                    setMeetings((prev) =>
                      prev.map((row) =>
                        row.id === m.id
                          ? { ...row, transcript, summary, ai_status: "done", ai_error: null }
                          : row,
                      ),
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </main>
      </div>

      <SendRecordingDialog
        meeting={shareTarget}
        currentUserId={userId}
        onClose={() => setShareTarget(null)}
      />
    </div>
  );
}

function FolderExplorer({
  folders, selected, onSelect, allCount, favoritesCount, receivedCount, unfiledCount, countsByFolder,
  onCreate, onRename, onDelete,
}: {
  folders: FolderRow[];
  selected: FolderSel;
  onSelect: (s: FolderSel) => void;
  allCount: number;
  favoritesCount: number;
  receivedCount: number;
  unfiledCount: number;
  countsByFolder: Record<string, number>;
  onCreate: () => void;
  onRename: (f: FolderRow) => void;
  onDelete: (f: FolderRow) => void;
}) {
  return (
    <aside className="w-56 shrink-0">
      <div className="sticky top-20">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pastas</span>
          <button
            onClick={onCreate}
            title="Nova pasta"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
        <nav className="space-y-0.5">
          <FolderItem
            icon={<Inbox className="w-4 h-4" />}
            label="Minhas reuniões"
            count={allCount}
            active={selected === "all"}
            onClick={() => onSelect("all")}
          />
          <FolderItem
            icon={<Star className={`w-4 h-4 ${selected === "favorites" ? "fill-current" : ""}`} />}
            label="Favoritas"
            count={favoritesCount}
            active={selected === "favorites"}
            onClick={() => onSelect("favorites")}
          />
          <FolderItem
            icon={<Mail className="w-4 h-4" />}
            label="Gravações recebidas"
            count={receivedCount}
            active={selected === "received"}
            onClick={() => onSelect("received")}
          />

          {folders.map((f) => (
            <FolderItem
              key={f.id}
              icon={selected === f.id ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
              label={f.name}
              count={countsByFolder[f.id] ?? 0}
              active={selected === f.id}
              onClick={() => onSelect(f.id)}
              onRename={() => onRename(f)}
              onDelete={() => onDelete(f)}
            />
          ))}
          {unfiledCount > 0 && (
            <FolderItem
              icon={<Folder className="w-4 h-4 opacity-50" />}
              label="Sem pasta"
              count={unfiledCount}
              active={selected === "unfiled"}
              onClick={() => onSelect("unfiled")}
              muted
            />
          )}
        </nav>
      </div>
    </aside>
  );
}

function FolderItem({
  icon, label, count, active, onClick, onRename, onDelete, muted,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  muted?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer ${
        active ? "bg-primary/10 text-primary" : muted ? "text-muted-foreground hover:bg-muted/50" : "hover:bg-muted/50"
      }`}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-sm truncate">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      {(onRename || onDelete) && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
          {onRename && (
            <button
              onClick={(e) => { e.stopPropagation(); onRename(); }}
              className="p-0.5 rounded hover:bg-background"
              title="Renomear"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-0.5 rounded hover:bg-background text-destructive"
              title="Excluir"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ selected, hasQuery }: { selected: FolderSel; hasQuery: boolean }) {
  if (hasQuery) {
    return (
      <div className="border border-dashed rounded-xl p-10 text-center">
        <Search className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
        <div className="font-semibold mb-1">Nada encontrado</div>
        <div className="text-sm text-muted-foreground">Tente outros termos ou limpe a busca.</div>
      </div>
    );
  }
  return (
    <div className="border border-dashed rounded-xl p-10 text-center">
      <Video className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
      <div className="font-semibold mb-1">
        {selected === "all" ? "Nenhuma reunião por aqui ainda"
        : selected === "favorites" ? "Sem favoritas ainda"
        : "Esta pasta está vazia"}
      </div>
      <div className="text-sm text-muted-foreground">
        {selected === "all"
          ? "Entre numa sala de reunião com pelo menos mais uma pessoa para começar seu histórico."
          : selected === "favorites"
          ? "Toque na estrela em qualquer reunião para favoritar."
          : "Mova reuniões para esta pasta usando o botão de pasta no card."}
      </div>
    </div>
  );
}

/** Nomes dos participantes da reunião, deduplicados por user_id e sem inventar nomes. */
function participantNamesOf(
  participants: ParticipantRow[],
  profilesById: Record<string, { display_name: string; avatar_color: string }>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const p of participants) {
    if (seen.has(p.user_id)) continue;
    seen.add(p.user_id);
    const name = profilesById[p.user_id]?.display_name;
    if (name) names.push(name);
  }
  return names;
}

function MeetingCard({
  meeting,
  participants,
  profilesById,
  hostProfile,
  receivedFromSenderId,
  receivedFromProfile,
  folders,
  meetingFolderIds,
  isFavorite,
  onToggleFavorite,
  onRename,
  onToggleFolder,
  onCreateFolder,
  onShare,
  onAiUpdated,
  canDelete,
  onDeleted,
}: {
  meeting: MeetingRow;
  participants: ParticipantRow[];
  profilesById: Record<string, { display_name: string; avatar_color: string }>;
  hostProfile?: { display_name: string; avatar_color: string };
  receivedFromSenderId: string | null;
  receivedFromProfile?: { display_name: string; avatar_color: string };
  folders: FolderRow[];
  meetingFolderIds: Set<string>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRename: (newTitle: string) => void;
  onToggleFolder: (folderId: string, isMember: boolean) => void;
  onCreateFolder: () => void;
  onShare: () => void;
  onAiUpdated: (transcript: string, summary: string) => void;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const start = new Date(meeting.started_at);
  const end = meeting.ended_at ? new Date(meeting.ended_at) : null;
  const durationMin = end
    ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    : null;
  const isLive = !end;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.title ?? meeting.zone_label);
  const hasContent = !!(meeting.recording_path || meeting.summary || meeting.transcript);
  const uniqueCount = new Set(participants.map((p) => p.user_id)).size;
  const names = participantNamesOf(participants, profilesById);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    const current = meeting.title ?? "";
    if (next === current) return;
    onRename(next);
  };

  return (
    <li className="border rounded-xl bg-card overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasContent}
          aria-expanded={open}
          aria-label={open ? "Recolher reunião" : "Expandir reunião"}
          className={`mt-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 transition-colors ${hasContent ? "" : "opacity-30 cursor-default"}`}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 cursor-pointer"
          style={{ background: hostProfile?.avatar_color ?? "#475569" }}
          onClick={() => hasContent && setOpen((v) => !v)}
        >
          <Video className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {editing ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") { setDraft(meeting.title ?? meeting.zone_label); setEditing(false); }
                  }}
                  className="flex-1 min-w-0 text-sm font-semibold border rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button onClick={commitRename} className="p-1 text-emerald-600 hover:bg-muted rounded" title="Salvar">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setDraft(meeting.title ?? meeting.zone_label); setEditing(false); }}
                  className="p-1 text-muted-foreground hover:bg-muted rounded"
                  title="Cancelar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => hasContent && setOpen((v) => !v)}
                  className="font-semibold truncate text-left hover:underline"
                >
                  {meeting.title ?? meeting.zone_label}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDraft(meeting.title ?? meeting.zone_label); setEditing(true); }}
                  className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                  title="Renomear reunião"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </>
            )}
            {isLive && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Em andamento
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={onToggleFavorite}
                title={isFavorite ? "Remover dos favoritos" : "Favoritar"}
                className={`p-1 rounded hover:bg-muted ${isFavorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Star className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
              </button>
              {meeting.recording_path && (
                <button
                  onClick={onShare}
                  title="Enviar reunião"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
              {canDelete && <DeleteMeetingButton meetingId={meeting.id} onDeleted={onDeleted} />}
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1">
                  <FolderInput className="w-3 h-3" />
                  {meetingFolderIds.size > 0
                    ? `${meetingFolderIds.size} pasta${meetingFolderIds.size === 1 ? "" : "s"}`
                    : "Mover para pasta"}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs">Organizar em pastas</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {folders.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhuma pasta ainda.
                    </div>
                  )}
                  {folders.map((f) => {
                    const isMember = meetingFolderIds.has(f.id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={f.id}
                        checked={isMember}
                        onCheckedChange={() => onToggleFolder(f.id, isMember)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {f.name}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onCreateFolder}>
                    <FolderPlus className="w-3 h-3 mr-2" /> Nova pasta…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {start.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {durationMin ? ` · ${durationMin} min` : ""}
            </span>
            <span className="inline-flex items-center gap-1" title={names.join(", ")}>
              <Users className="w-3 h-3" />
              {uniqueCount > 0 ? (
                <>
                  {uniqueCount} participante{uniqueCount === 1 ? "" : "s"}
                  {names.length > 0 && (
                    <span className="text-muted-foreground/80 truncate max-w-[22rem]">
                      · {names.join(", ")}
                    </span>
                  )}
                </>
              ) : (
                "Participantes não registrados"
              )}
            </span>
            <span className="text-muted-foreground/80">· {meeting.zone_label}</span>
            {receivedFromSenderId && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                <Mail className="w-3 h-3" />
                Recebido{receivedFromProfile ? ` de ${receivedFromProfile.display_name}` : ""}
              </span>
            )}
            <AiStatusBadge meeting={meeting} />
          </div>

          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              {meeting.recording_path && (
                <RecordingPlayer
                  meetingId={meeting.id}
                  path={meeting.recording_path}
                  durationSec={meeting.recording_duration_seconds ?? null}
                  active={open}
                />
              )}

              {meeting.recording_path && (
                <AiPanel meeting={meeting} participantNames={names} onAiUpdated={onAiUpdated} />
              )}

              <PersonalNotes meetingId={meeting.id} active={open} />

            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function AiStatusBadge({ meeting }: { meeting: MeetingRow }) {
  const status = meeting.ai_status;
  const hasAi = !!(meeting.summary || meeting.transcript);
  if (hasAi && status !== "error") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> Resumo pronto
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-primary">
        <Loader2 className="w-3 h-3 animate-spin" /> Gerando resumo…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <AlertCircle className="w-3 h-3" /> Falha no resumo
      </span>
    );
  }
  if (meeting.recording_path) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Sparkles className="w-3 h-3" /> Pendente
      </span>
    );
  }
  return null;
}

const mdComponents = {
  h1: (p: any) => <h3 className="text-base font-semibold mt-3 mb-1" {...p} />,
  h2: (p: any) => <h3 className="text-base font-semibold mt-3 mb-1" {...p} />,
  h3: (p: any) => <h4 className="text-sm font-semibold mt-3 mb-1" {...p} />,
  h4: (p: any) => <h5 className="text-sm font-semibold mt-2 mb-1" {...p} />,
  p: (p: any) => <p className="my-1" {...p} />,
  ul: (p: any) => <ul className="list-disc pl-5 my-1 space-y-0.5" {...p} />,
  ol: (p: any) => <ol className="list-decimal pl-5 my-1 space-y-0.5" {...p} />,
  li: (p: any) => <li className="my-0" {...p} />,
  strong: (p: any) => <strong className="font-semibold" {...p} />,
  em: (p: any) => <em className="italic" {...p} />,
  a: (p: any) => <a className="text-primary hover:underline" {...p} />,
  code: (p: any) => <code className="px-1 py-0.5 rounded bg-muted text-[0.85em]" {...p} />,
};

function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80) || "reuniao";
}

function AiPanel({
  meeting,
  participantNames,
  onAiUpdated,
}: {
  meeting: MeetingRow;
  participantNames: string[];
  onAiUpdated: (transcript: string, summary: string) => void;
}) {
  const generate = useServerFn(generateMeetingAi);
  const hasAi = !!(meeting.summary || meeting.transcript);
  const [busy, setBusy] = useState(meeting.ai_status === "processing" || (!hasAi && meeting.ai_status !== "error"));
  const [openTranscript, setOpenTranscript] = useState(false);
  const triedRef = useRef(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await generate({ data: { meetingId: meeting.id } });
      onAiUpdated(res.transcript, res.summary);
    } catch {
      // erro fica salvo em meeting.ai_error via servidor
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (triedRef.current) return;
    if (hasAi) return;
    if (meeting.ai_status === "error") return;
    triedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  const baseName = safeFilename(meeting.title ?? meeting.zone_label);
  const dateStr = new Date(meeting.started_at).toISOString().slice(0, 10);

  const exportSummary = () => {
    if (!meeting.summary) return;
    const header = `# ${meeting.title ?? meeting.zone_label}\n\n_${new Date(meeting.started_at).toLocaleString("pt-BR")}_\n\n`;
    downloadText(`${dateStr}_${baseName}_resumo.md`, header + meeting.summary);
  };

  const exportTranscript = () => {
    if (!meeting.transcript) return;
    const header = `# Transcrição — ${meeting.title ?? meeting.zone_label}\n\n_${new Date(meeting.started_at).toLocaleString("pt-BR")}_\n\n`;
    downloadText(`${dateStr}_${baseName}_transcricao.md`, header + meeting.transcript);
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Sparkles className="w-3 h-3" />
        <span>Resumo automático</span>
        <div className="ml-auto flex items-center gap-2">
          {busy ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Gerando…
            </span>
          ) : hasAi ? (
            <>
              <button
                onClick={exportSummary}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                title="Baixar resumo (.md)"
              >
                <Download className="w-3 h-3" /> Resumo
              </button>
              <button
                onClick={() => void run()}
                className="text-primary hover:underline"
              >
                Refazer
              </button>
            </>
          ) : meeting.ai_status === "error" ? (
            <button
              onClick={() => void run()}
              className="text-primary hover:underline"
            >
              Tentar novamente
            </button>
          ) : null}
        </div>
      </div>
      {meeting.ai_error && !busy && (
        <div className="text-xs text-destructive mb-2 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {meeting.ai_error}
        </div>
      )}
      {participantNames.length > 0 && (
        <div className="text-xs text-muted-foreground mb-2 inline-flex items-start gap-1">
          <Users className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Participantes: {participantNames.join(", ")}</span>
        </div>
      )}
      {busy && !meeting.summary && (
        <div className="text-sm bg-muted/40 rounded-md p-4 space-y-2 animate-pulse">
          <div className="h-3 bg-muted rounded w-3/4" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
      )}
      {meeting.summary && (
        <div className="text-sm leading-relaxed bg-muted/40 rounded-md p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {meeting.summary}
          </ReactMarkdown>
        </div>
      )}
      {meeting.transcript && (
        <div className="mt-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpenTranscript((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <FileText className="w-3 h-3" />
              {openTranscript ? "Esconder" : "Ver"} transcrição completa
              <ChevronDown
                className={`w-3 h-3 transition-transform ${openTranscript ? "rotate-180" : ""}`}
              />
            </button>
            <button
              onClick={exportTranscript}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Baixar transcrição (.md)"
            >
              <Download className="w-3 h-3" /> Transcrição
            </button>
          </div>
          {openTranscript && (
            <div className="mt-2 text-xs bg-muted/30 rounded-md p-3 max-h-96 overflow-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {meeting.transcript}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecordingPlayer({
  meetingId,
  path,
  durationSec,
  active = true,
}: {
  meetingId: string;
  path: string;
  durationSec: number | null;
  active?: boolean;
}) {
  const getUrlFn = useServerFn(getRecordingUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    if (url || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const r = await getUrlFn({ data: { meetingId } });
      if (r.ok) setUrl(r.url);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, active]);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Video className="w-3 h-3" />
        <span>Gravação{durationSec ? ` · ${formatDur(durationSec)}` : ""}</span>
        {url && (
          <a
            href={url}
            download
            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
          >
            <Download className="w-3 h-3" /> Baixar vídeo
          </a>
        )}
      </div>
      {url ? (
        <video
          controls
          src={url}
          className="w-full rounded-md bg-black aspect-video"
          preload="metadata"
        />
      ) : failed ? (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <span>Não consegui abrir a gravação agora.</span>
          <button onClick={() => void load()} className="text-primary hover:underline">
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Carregando gravação…
        </div>
      )}
    </div>
  );
}

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function PersonalNotes({ meetingId, active }: { meetingId: string; active: boolean }) {
  const [body, setBody] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const loadedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carrega ao expandir (uma única vez)
  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setLoaded(true); return; }
      const { data } = await sb
        .from("meeting_notes")
        .select("id, body")
        .eq("meeting_id", meetingId)
        .eq("user_id", uid)
        .maybeSingle();
      if (data) {
        setNoteId(data.id);
        setBody(data.body ?? "");
      }
      setLoaded(true);
    })();
  }, [active, meetingId]);

  // Auto-save com debounce
  useEffect(() => {
    if (!loaded) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      setSaving(true);
      try {
        if (noteId) {
          await sb.from("meeting_notes").update({ body }).eq("id", noteId);
        } else if (body.trim().length > 0) {
          const { data } = await sb
            .from("meeting_notes")
            .insert({ meeting_id: meetingId, user_id: uid, body })
            .select("id")
            .single();
          if (data) setNoteId(data.id);
        }
        setSavedAt(Date.now());
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, loaded]);

  return (
    <section className="mt-4 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <Pencil className="w-3.5 h-3.5" /> Minhas anotações
          <span className="text-[10px] font-normal text-muted-foreground">(privadas)</span>
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {saving ? (
            <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Salvando…</span>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="w-3 h-3" /> Salvo</span>
          ) : null}
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!loaded}
        placeholder={loaded ? "Escreva aqui suas anotações pessoais sobre esta reunião…" : "Carregando…"}
        rows={4}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      />
    </section>
  );
}

type MemberPick = { user_id: string; display_name: string; avatar_color: string };

function SendRecordingDialog({
  meeting,
  currentUserId,
  onClose,
}: {
  meeting: MeetingRow | null;
  currentUserId: string | null;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<MemberPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [access, setAccess] = useState<Map<string, AccessKind>>(new Map());

  useEffect(() => {
    if (!meeting) return;
    setAccess(new Map());
    void sb.rpc("meeting_access_status", { _meeting_id: meeting.id }).then(
      ({ data }: { data: Array<{ user_id: string; kind: string }> | null }) => {
        setAccess(buildAccessMap(data ?? []));
      },
    );
    setQ("");
    setSelected(new Set());
    setConfirming(false);
    setLoading(true);
    (async () => {
      const { data: mems } = await sb
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", meeting.workspace_id);
      const ids = ((mems ?? []) as { user_id: string }[])
        .map((m) => m.user_id)
        .filter((id) => id !== currentUserId);
      if (ids.length === 0) {
        setMembers([]);
        setLoading(false);
        return;
      }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_color")
        .in("id", ids);
      const list: MemberPick[] = ((profs ?? []) as Array<{ id: string; display_name: string; avatar_color: string }>)
        .map((p) => ({ user_id: p.id, display_name: p.display_name, avatar_color: p.avatar_color }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
      setMembers(list);
      setLoading(false);
    })();
  }, [meeting, currentUserId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return members;
    return members.filter((m) => m.display_name.toLowerCase().includes(t));
  }, [members, q]);

  const validSelected = useMemo(() => validSelection(selected, access), [selected, access]);
  const selectedNames = members.filter((m) => validSelected.has(m.user_id)).map((m) => m.display_name);

  const toggle = (id: string) =>
    !access.has(id) && setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmSend = async () => {
    if (!meeting || !canSubmitSelection(validSelected)) return;
    const meetingId = meeting.id;
    setSending(true);
    const { data, error } = await sb.rpc("meeting_share_recording_batch", {
      _meeting_id: meetingId,
      _recipient_ids: Array.from(validSelected),
    });
    setSending(false);
    if (error) {
      console.error("[share]", error);
      toast.error("Não foi possível enviar a reunião. Nada foi enviado — tente de novo.");
      return;
    }
    const { batch_id: batchId, created } = data as { batch_id: string; created: string[] };
    setConfirming(false);
    onClose();
    if (created.length === 0) {
      toast.info("Essas pessoas já tinham acesso a esta reunião.");
      return;
    }
    toast.success(sentToast(created.length), {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Desfazer",
        onClick: async () => {
          const { error: undoErr } = await sb.rpc("meeting_undo_share_batch", {
            _meeting_id: meetingId,
            _batch_id: batchId,
          });
          if (undoErr) toast.error("Não foi possível desfazer o envio.");
          else toast.success("Envio desfeito.");
        },
      },
    });
  };

  return (
    <>
      <Dialog open={!!meeting && !confirming} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <Send className="w-4 h-4" /> Enviar reunião
            </DialogTitle>
            <DialogDescription>
              Escolha uma ou mais pessoas do espaço. Elas vão receber a reunião em
              <span className="font-medium"> Gravações recebidas</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar colaborador…"
              className="pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background w-full focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="max-h-72 overflow-auto -mx-1 px-1">
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
                <Loader2 className="w-3 h-3 animate-spin" /> Carregando colaboradores…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Nenhum colaborador encontrado.</div>
            ) : (
              <ul className="space-y-1">
                {filtered.map((m) => {
                  const has = access.get(m.user_id);
                  return (
                  <li key={m.user_id}>
                    <label
                      aria-disabled={!!has}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-md ${has ? "opacity-50 cursor-not-allowed" : "hover:bg-muted cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!!has}
                        checked={!has && selected.has(m.user_id)}
                        onChange={() => toggle(m.user_id)}
                        className="w-4 h-4 accent-primary"
                      />
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ background: m.avatar_color }}
                      >
                        {m.display_name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="flex-1 text-sm truncate">{m.display_name}</span>
                      {has && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">
                          {accessBadge(has)}
                        </span>
                      )}
                    </label>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            <span className="text-xs text-muted-foreground">{selectionLabel(validSelected.size)}</span>
            <button
              onClick={() => setConfirming(true)}
              disabled={!canSubmitSelection(validSelected)}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Enviar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!meeting && confirming} onOpenChange={(o) => { if (!o && !sending) setConfirming(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar esta reunião?</DialogTitle>
            <DialogDescription>{confirmQuestion(selectedNames)}</DialogDescription>
          </DialogHeader>
          {selectedNames.length > 1 && (
            <ul className="text-sm max-h-40 overflow-auto list-disc pl-5">
              {selectedNames.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setConfirming(false)}
              disabled={sending}
              className="px-3 py-1.5 rounded-md border text-sm hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              onClick={confirmSend}
              disabled={sending}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {sending && <Loader2 className="w-3 h-3 animate-spin" />} Confirmar envio
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const DELETE_ERRORS: Record<string, string> = {
  FORBIDDEN: "Você não tem permissão para excluir esta reunião.",
  NOT_FOUND: "Esta reunião não existe mais.",
  RECORDING_ACTIVE: "A gravação ainda está em andamento. Aguarde terminar para excluir.",
  STORAGE_DELETE_FAILED: "Não consegui apagar o arquivo da gravação. Nada foi excluído — tente de novo em instantes.",
  DB_DELETE_FAILED: "O arquivo foi apagado, mas não consegui remover os dados da reunião. Tente de novo.",
};

function DeleteMeetingButton({ meetingId, onDeleted }: { meetingId: string; onDeleted: () => void }) {
  const del = useServerFn(deleteMeeting);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await del({ data: { meetingId } });
      if (res.ok) {
        setOpen(false);
        toast.success("Reunião excluída permanentemente.");
        onDeleted();
      } else {
        toast.error(DELETE_ERRORS[res.code] ?? "Não foi possível excluir a reunião. Tente de novo.");
      }
    } catch (e) {
      console.error("[deleteMeeting]", e);
      toast.error("Não foi possível excluir a reunião. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Excluir reunião"
        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta reunião?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e não pode ser desfeita. A gravação, transcrição, resumo e demais dados associados serão excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void run(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir permanentemente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
