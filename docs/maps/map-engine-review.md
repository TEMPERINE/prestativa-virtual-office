# Revisão do motor de mapas

Base inicial: `5b65fab039743f893be236eed3bdb8be880025cd`, branch `codex/office-chat-mvp`. Antes do push, foi incorporado também o novo HEAD remoto `a3ff205085a9dc7153637cbdf3fc46a390cf90f8` (personagem Lucas), reaplicando somente o commit local de mapas, sem conflito e sem merge na main. Alterações Lovable preservadas. Nenhuma migration, SQL, mudança de dados reais, merge ou publicação faz parte desta entrega.

## Causas e correções

1. O editor assumia `workspace` para custom sem `kind`; o runtime assumia `common`. Agora `resolveZoneKind` é a regra única: `zoneKinds[id]` válido → `custom.kind` válido → default da zona embutida → `workspace` para custom legada → `common` para ID desconhecido. Nova custom nasce com `kind: "workspace"`; normalização/export/salvamento explicitam o kind, sem escrever automaticamente no mapa real. O usuário continua podendo alternar para comum.
2. Centro + quatro amostras não cobriam as quinas do footprint; validar somente destino também permitia atravessar uma parede em passos maiores. A colisão agora calcula a distância exata entre o percurso do centro e cada célula bloqueada próxima: o círculo varrido não pode intersectar nem tangenciar a célula. Raio existente `0.014` preservado; o círculo também deve caber no piso. Movimento horizontal/vertical usa a mesma função; movimento paralelo continua permitido. O caminho normal inspeciona apenas células no entorno do passo, nunca o mapa inteiro.
3. O retângulo envolvente preenchia buracos de zonas irregulares e recebia eventos de ponteiro nos corredores. Com override, membership usa somente a célula pintada. SVG de segmentos pintados recebe hover; o retângulo posiciona o card. Colocação de recados e destinos de spawn verificam a área exata. A lista reivindicável reage a mudanças do mapa, sem depender de uma alteração de claims.
4. Posição persistida era mantida antes da carga, mas não validada depois. A recuperação exige posição hidratada, fetch inicial concluído e MapSync `READY`. Cache não confirmado, respostas malformadas/antigas (inclusive metadados custom inválidos) e `ERROR` não autorizam correção. Uma resposta canônica da mesma versão substitui o cache local. Posição válida é preservada, inclusive se existir somente no navegador. Uma posição bloqueada procura o ponto seguro próximo, preferindo mesma zona quando próxima; usa o fluxo existente `setPos`/`sendPos`, sem novo protocolo. Atualizações do mapa repetem a validação; eventos repetidos não geram novos saltos. Mapa sem qualquer ponto seguro retorna indisponibilidade, sem inventar um destino inseguro. O destino de retorno por inatividade também passa pela geometria do mapa atual; o controlador de reuniões permanece intacto. Teleporte de zona revalida colisão e membership antes do salto, caso a pintura mude durante a animação.

## Validação e diagnóstico

Análise debounced no editor e validação síncrona do documento no Salvar; o transporte compartilhado de salvamento também rejeita erro estrutural, inclusive ao salvar tema. Nenhum mapa existente é corrigido ou regravado automaticamente.

Erros: grade inválida, zona desconhecida/vazia, área sem espaço para o footprint, spawn fora da própria zona/em obstáculo e workspace sem caminho de saída. Erros bloqueiam Salvar. Avisos: spawn implícito seguro e partes caminháveis desconectadas do spawn; permitem salvar. As mensagens identificam a área, podem selecioná-la e destacam células problemáticas; paredes, pintura, pinos e tipo Trabalho/Comum aparecem no editor. Save Points continuam snapshots de rascunho: sua restauração passa pelo mesmo validador ao salvar o mapa.

BFS ocorre somente na análise/salvamento, com amostras de meia célula e arestas verificadas pela mesma colisão varrida. Isso inclui passagens de quatro colunas, cujo centro útil fica entre centros de células originais. É uma malha discreta conservadora; a colisão do runtime é geométrica. Recuperação excepcional também usa amostras de meia célula e não roda a cada frame.

## Arquivos funcionais

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/map-zone-kind.ts` | Kind canônico e criação explícita de custom |
| `src/lib/map-walkability.ts` | Footprint, contato e percurso varrido |
| `src/lib/workspace-zones.ts` | Membership pintado, lista reivindicável e hit path |
| `src/lib/map-navigation.ts` | Spawn seguro e decisão de recuperação |
| `src/lib/map-validation.ts` | Diagnóstico estrutural e conectividade |
| `src/lib/map-overrides.ts` | Consumir kind/colisão únicos e validar salvamento |
| `src/lib/map-sync.ts` | Normalizar kind e confirmar mapa canônico antes de READY |
| `src/lib/office-map.ts` | Colisão única com piso/mapa base ou editado |
| `src/lib/legacy-call-zone.ts` | Adaptador legado usa somente geometria do grid |
| `src/lib/rtc/canonical-zones.ts` | Apenas resolução geométrica/kind compartilhada com cliente/Token; sem alteração de classificação RTC ou mídia |
| `src/components/office/OfficeScene.tsx` | Movimento, recuperação, hover e destinos seguros |
| `src/components/office/MapEditor.tsx` | Kind, validação e diagnóstico visual |

Testes: novos `map-engine.test.ts`, `map-navigation.test.ts`, `map-validation.test.ts`, `OfficeScene.map.test.tsx`, `MapEditor.test.tsx`; ampliados `map-sync.test.ts` e `map-reset.test.ts`. Suites existentes de paridade de zona também verificadas. Planejamento: `docs/maps/map-engine-spec.md` e `docs/superpowers/plans/2026-10-16-map-engine.md`.

## Validação e homologação

O teste de integração monta OfficeScene real, finge somente I/O e verifica recuperação/persistência, posição local sem snapshot do banco, mudanças ao vivo, canais preservados, teclado paralelo à parede e hover que desaparece no buraco de uma zona em L. O teste do editor real verifica bloqueio do salvamento, aviso permitido e exportação/toggle de kind. O cenário de retorno por inatividade observa o hook real e invoca sua callback com uma posição capturada por `MeetingReturnPosition` real, sem simular uma sessão RTC. Nenhum teste usa banco real.

Microbenchmark local de 200 mil verificações de passo junto à parede: aproximadamente 44 ms no total (0,22 µs/verificação após otimização do Node). É uma medida isolada, não garantia de FPS do app ou de hardware do usuário. BFS fica fora do frame loop e o editor aguarda 180 ms após a última pintura para analisar.

Homologação manual antes de publicar: abrir mapa real sem salvar; verificar mesas e áreas comuns, passar junto a paredes/quinas/portas e navegar com zoom; testar hover/recados em sala irregular; em ambiente de homologação, editar um mapa para bloquear uma posição online e confirmar recuperação com outra conta. O footprint completo pode revelar portas/mapas legados estreitos ou spawns inválidos que antes eram tolerados. O editor explicará esses erros; nenhum ajuste automático foi feito nos dados reais.

Chat, SQL, Superadmin, RoomManager, protocolos RTC/Presence, screen share, gravação, dependências e lockfiles permanecem fora da alteração. A mudança em `rtc/canonical-zones.ts` é exclusivamente o adaptador da geometria do mapa, preservando a mesma resolução no cliente e no Token.

Verificação final local: **75/75 testes específicos de mapa/paridade, 806/806 testes Vitest em 74 arquivos, `npx tsc --noEmit` e `npm run build` aprovados**. Após ajustar somente a tipagem da instrumentação de teste, o typecheck e os oito testes de OfficeScene foram repetidos e passaram. `git diff --check` passou. Comparação com a base confirmou ausência de alterações em Chat, SQL/Drizzle, Superadmin, integrações, Desktop, dependências e lockfiles.

Revisão independente final encontrou dois casos importantes e um menor (metadados custom malformados, retorno antigo por inatividade e repintura durante teleporte). Todos foram reproduzidos antes da correção, corrigidos e cobertos pela validação acima. Nenhum achado bloqueante permaneceu conhecido.

Após incorporar o commit Lovable do Lucas (`a3ff205`), a suíte completa **806/806**, typecheck e build foram executados novamente e passaram; catálogo e sprites foram preservados integralmente.
