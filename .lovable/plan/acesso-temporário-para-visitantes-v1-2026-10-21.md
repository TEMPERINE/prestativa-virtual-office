# Acesso temporário para visitantes (V1)

## O que muda para você
- Owner/admin do espaço vê "Convidar visitante" na barra do Office: gera link único com início, duração (1h a 30 dias ou personalizado) e mostra "Acesso válido de X até Y".
- Painel "Visitantes" com Agendados, Aguardando, Ativos e Encerrados; ações +1h/+4h/+12h/+24h, nova data e "Encerrar visita".
- Visitante abre `/visit/<token>`: boas-vindas, nome, personagem, tutorial curto e entra pela recepção com o selo VISITANTE.
- Visitante só anda (setas/WASD ou dois toques), vê pessoas e fala por proximidade. Não usa mesa, recado, props, portas, sino, editor, reuniões, gravação, Chat nem qualquer teleporte.
- Ao expirar ou ser encerrado, sai do Office na hora e vê a tela de visita encerrada.

## Etapas
1. Ligar o login anônimo, mantendo as demais configurações de login como estão.
2. Banco (migration nova): `workspace_visitor_invites` (só hash do token) e `workspace_visitors`; funções `is_active_workspace_visitor` e `can_access_workspace_runtime`; RPCs de criar, ativar, estender, encerrar e listar, todas validando owner/admin do espaço pela regra canônica. `is_workspace_member` permanece intacto.
3. Policies ampliadas só para visitante ativo: posição própria e leitura de posições/perfis de visitantes do mesmo espaço, Presence/canais do espaço, estado de props (somente leitura). Claims, recados, mapa, reuniões e Chat continuam exclusivos de membros.
4. Token de áudio/vídeo: aceitar visitante ativo, sem permissões de gravação/admin, com validade limitada ao fim da visita; mesma conexão única.
5. Office: camada única de capacidades (membro x visitante) que esconde e bloqueia ações proibidas, inclusive Ctrl+D/Ctrl+R/Ctrl+F e "Juntar-se"; toque em prop mostra "Visitantes não podem interagir com este item."
6. Expiração/revogação em tempo real: o servidor decide; o cliente ouve mudanças e um timer encerra movimento, RTC e sessão.
7. Rota pública `/visit/$token` com os estados: indisponível ainda, expirado, revogado, já utilizado; retorno no mesmo navegador sem novo onboarding.
8. Testes de regras (quem pode convidar, janelas de validade, bloqueios) e auditoria das permissões no banco.

## Detalhes técnicos
- Identidade = `auth.uid()` anônimo vinculado a `workspace_visitors.user_id`; sem perfis permanentes, sem `workspace_members`.
- Nomes/sprites de visitantes lidos de `workspace_visitors` e combinados com membros no Office.
- Sem publicação automática.
