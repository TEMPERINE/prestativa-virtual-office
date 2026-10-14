import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ meetingId: z.string().uuid() });

/**
 * URL temporária da gravação (WebM antigo no Cloud ou MP4 V2 no S3/R2).
 * Só para quem participou da reunião ou é administrador.
 */
export const getRecordingUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: meeting } = await (supabaseAdmin as any)
      .from("meetings")
      .select("id, workspace_id, recording_path")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (!meeting?.recording_path) return { ok: false as const, code: "NO_RECORDING" };

    const sb = context.supabase;
    const [part, wsAdmin, superadmin, share, member] = await Promise.all([
      sb.rpc("is_meeting_participant", { _meeting_id: meeting.id, _user_id: context.userId }),
      sb.rpc("is_workspace_admin", { _workspace_id: meeting.workspace_id, _user_id: context.userId }),
      sb.rpc("platform_is_superadmin"),
      // RLS: só retorna linha se recipient_id = auth.uid().
      sb.from("meeting_recording_shares").select("meeting_id")
        .eq("meeting_id", meeting.id).eq("recipient_id", context.userId).limit(1),
      sb.rpc("is_workspace_member", { _workspace_id: meeting.workspace_id, _user_id: context.userId }),
    ]);
    const { canViewRecording } = await import("./recording-access");
    if (!canViewRecording({
      isActiveMember: !!member.data,
      isParticipant: !!part.data,
      isShareRecipient: (share.data?.length ?? 0) > 0,
      isWorkspaceAdmin: !!wsAdmin.data,
      isGlobalAdmin: superadmin.data === true,
    })) {
      return { ok: false as const, code: "FORBIDDEN" };
    }

    const store = await import("./recording-storage.server");
    const backend = await store.resolveRecordingBackend(meeting.id, meeting.recording_path);
    try {
      const url = await store.getRecordingSignedUrl(backend, meeting.recording_path);
      return { ok: true as const, url, backend, expiresIn: store.SIGNED_URL_TTL_SECONDS };
    } catch (e) {
      const code = e instanceof Error && e.message === "STORAGE_NOT_CONFIGURED" ? "STORAGE_NOT_CONFIGURED" : "SIGN_FAILED";
      return { ok: false as const, code };
    }
  });

/**
 * Exclusão permanente de reunião. Somente quem iniciou a gravação ou administrador.
 * O navegador envia apenas o ID; o servidor resolve os arquivos a apagar.
 * Se a exclusão de algum arquivo falhar, nenhum registro é apagado.
 */
export const deleteMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: meeting } = await db
      .from("meetings")
      .select("id, workspace_id, recording_path, recorded_by")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (!meeting) return { ok: false as const, code: "NOT_FOUND" };

    const { data: egressRows } = await db
      .from("meeting_egress")
      .select("id, file_path, status, started_by")
      .eq("meeting_id", meeting.id);
    const egress = (egressRows ?? []) as { id: string; file_path: string | null; status: string; started_by: string }[];

    const sb = context.supabase;
    const [wsAdmin, superadmin] = await Promise.all([
      sb.rpc("is_workspace_admin", { _workspace_id: meeting.workspace_id, _user_id: context.userId }),
      sb.rpc("platform_is_superadmin"),
    ]);
    const isRecorder = meeting.recorded_by === context.userId || egress.some((e) => e.started_by === context.userId);
    if (!isRecorder && !wsAdmin.data && superadmin.data !== true) {
      return { ok: false as const, code: "FORBIDDEN" };
    }
    if (egress.some((e) => ["starting", "active", "ending"].includes(e.status))) {
      return { ok: false as const, code: "RECORDING_ACTIVE" };
    }

    const store = await import("./recording-storage.server");
    const s3Keys = new Set(egress.filter((e) => e.file_path && e.status === "complete").map((e) => e.file_path!));
    try {
      for (const key of s3Keys) await store.deleteS3ObjectConfirmed(key);
      if (meeting.recording_path && !s3Keys.has(meeting.recording_path)) {
        await store.deleteCloudObject(meeting.recording_path);
      }
    } catch (e) {
      console.error(`[deleteMeeting] storage delete failed meeting=${meeting.id}:`, e instanceof Error ? e.message : e);
      return { ok: false as const, code: "STORAGE_DELETE_FAILED" };
    }

    for (const table of [
      "meeting_notes", "meeting_favorites", "meeting_folder_items",
      "meeting_recording_shares", "meeting_participants", "meeting_egress",
    ]) {
      const { error } = await db.from(table).delete().eq("meeting_id", meeting.id);
      if (error) {
        console.error(`[deleteMeeting] ${table} delete failed:`, error.message);
        return { ok: false as const, code: "DB_DELETE_FAILED" };
      }
    }
    const { error: mErr } = await db.from("meetings").delete().eq("id", meeting.id);
    if (mErr) {
      console.error("[deleteMeeting] meetings delete failed:", mErr.message);
      return { ok: false as const, code: "DB_DELETE_FAILED" };
    }
    return { ok: true as const };
  });
