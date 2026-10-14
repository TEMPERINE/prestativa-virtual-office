// Admin-only: gera 1 frame de caminhada a partir de uma imagem de referência.
// Usa Nano Banana 2 (gemini-3.1-flash-image-preview) — bom em manter
// consistência de personagem entre frames.

import { createServerFn } from "@tanstack/react-start";
import { requireSuperadmin } from "@/lib/admin/permissions.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Facing = "down" | "up" | "left" | "right";


const POSE_BY_FACING: Record<Facing, string> = {
  down: "facing the camera (front view), walking toward the viewer",
  up: "with their back to the camera (back view), walking away from the viewer",
  left: "in left-facing side profile, walking to the left",
  right: "in right-facing side profile, walking to the right",
};

const WALK_POSES = [
  "left foot stepping forward in a clear stride, right arm swinging forward, right leg back, mid-walk pose",
  "feet close together at mid-stride passing position, arms vertically aligned, neutral posture",
  "right foot stepping forward in a clear stride, left arm swinging forward, left leg back, mid-walk pose",
] as const;

function buildPrompt(facing: Facing, walkIndex: 0 | 1 | 2): string {
  return [
    "Pixel-art / illustrated game character sprite.",
    "ABSOLUTELY KEEP the same character identity: same hair, same face, same outfit, same colors, same body proportions and exact same art style as the reference image.",
    "Only change the body pose to the one described below.",
    "Render the character full-body, centered, on a SOLID PURE WHITE background (#FFFFFF), no shadow, no ground, no border, no text.",
    "Keep the character at the SAME SIZE and SAME VERTICAL POSITION (feet at the bottom) as the reference.",
    `View: ${POSE_BY_FACING[facing]}.`,
    `Pose: ${WALK_POSES[walkIndex]}.`,
  ].join(" ");
}

export const adminGenerateWalkFrame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { refImageBase64: string; facing: Facing; walkIndex: 0 | 1 | 2 }) => {
      if (!input.refImageBase64?.startsWith("data:image/"))
        throw new Error("refImageBase64 deve ser data URL");
      if (!["down", "up", "left", "right"].includes(input.facing))
        throw new Error("facing inválido");
      if (![0, 1, 2].includes(input.walkIndex)) throw new Error("walkIndex inválido");
      return input;
    },
  )
  .handler(async ({ context, data }) => {
    await requireSuperadmin(context);
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const prompt = buildPrompt(data.facing, data.walkIndex);
    const body = {
      model: "google/gemini-3.1-flash-image-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: data.refImageBase64 } },
          ],
        },
      ],
      modalities: ["image", "text"],
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("Créditos de IA esgotados na workspace.");
      if (res.status === 429) throw new Error("Rate limit da IA — tente em alguns segundos.");
      throw new Error(`AI Gateway ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("Resposta da IA sem imagem");
    return { b64 };
  });
