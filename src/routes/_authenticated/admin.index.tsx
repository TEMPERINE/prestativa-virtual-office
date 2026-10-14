import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Building2, Sparkles, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin — Prestativa Office" }] }),
  component: AdminHub,
});

function AdminHub() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { navigate({ to: "/auth" }); return; }
      const { data } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", u.user.id).eq("role", "superadmin").maybeSingle();
      setAllowed(!!data);
    })();
  }, []);

  if (allowed === null) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!allowed) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center glass-panel rounded-2xl p-8">
        <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground">Apenas administradores.</p>
      </div>
    </div>
  );

  const cards = [
    { to: "/admin/contas", icon: Users, title: "Contas", desc: "Criar usuários, definir plano, atribuir a espaços." },
    { to: "/admin/espacos", icon: Building2, title: "Espaços", desc: "Criar espaços, editar mapas e cenários sem entrar." },
    { to: "/admin/personagens", icon: Sparkles, title: "Personagens", desc: "Adicionar e renomear skins, exclusivas por espaço." },
  ] as const;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <button onClick={() => navigate({ to: "/workspaces" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Painel administrativo</h1>
        <p className="text-sm text-muted-foreground mb-10">
          Tudo que apenas você pode fazer.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {cards.map((c) => (
            <Link key={c.to} to={c.to}
              className="glass-panel rounded-2xl p-6 hover:shadow-soft transition border border-transparent hover:border-primary/30 group">
              <c.icon className="text-primary mb-3" size={28} />
              <div className="font-semibold text-lg mb-1 group-hover:text-primary transition">{c.title}</div>
              <div className="text-xs text-muted-foreground">{c.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
