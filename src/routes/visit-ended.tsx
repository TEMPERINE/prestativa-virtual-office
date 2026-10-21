import { createFileRoute } from "@tanstack/react-router";
import { VisitEndedScreen } from "@/components/visitors/VisitWatch";

export const Route = createFileRoute("/visit-ended")({
  head: () => ({
    meta: [
      { title: "Visita encerrada — Prestativa Office" },
      { name: "description", content: "Seu acesso temporário de visitante ao Prestativa Office terminou." },
      { property: "og:title", content: "Visita encerrada — Prestativa Office" },
      { property: "og:description", content: "Seu acesso temporário de visitante ao Prestativa Office terminou." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <VisitEndedScreen reason="expired" />,
});
