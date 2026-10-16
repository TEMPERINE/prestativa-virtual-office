# Map engine Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Pedido detalhado já autoriza implementação e commit/push; seguir sem nova rodada de aprovação de detalhes locais. Uma revisão independente final, correções importantes com RED→GREEN.

**Goal:** Uma única geometria de mapa para kind, footprint, membership e validação, corrigindo os dois bugs sem editar mapas reais.
**Architecture:** Helpers puros de kind, colisão e navegação alimentam editor/runtime. MapSync normaliza metadados. OfficeScene reutiliza persistência existente e espera READY. Retângulos ficam no layout visual.
**Tech Stack:** React/TypeScript, grade128×80, geometria círculo/retângulo e BFS, Vitest/jsdom.
**Spec:** ../../maps/map-engine-spec.md

## Global Constraints

Base inicial remota 5b65fab; atualização remota a3ff205 (Lucas) preservada antes da entrega; sem Chat/SQL/Superadmin/Presence/transporte RTC/deploy/novas dependências. `canonical-zones.ts` somente fonte geométrica compartilhada de mapa; manter classificação/mídia. Sem writes remotos durante trabalho.

## Review Focus

- Cache restaurado e posição assíncrona não provocam recuperação antes do fetch canônico/READY.
- Zona irregular inclui buracos: nenhum hover, claim hit, colocação ou spawn funcional usa bounding box.
- Círculo tangente, quina e passo grande não entram/atravessam uma célula; paralelo não prende.
- Mapas legados e zona embutida migrada mantêm override de kind autoritativo, sem zonas fantasmas.
- Erros do editor bloqueiam save em todos os caminhos; warnings e alterações locais não publicam nada.

### 1. Kind e geometria de células
Files: novos src/lib/map-zone-kind.ts, map-walkability.ts; map-overrides.ts, map-sync.ts, office-map.ts; testes puros em src/lib/__tests__/map-engine.test.ts.
Interfaces: resolveZoneKind(map,id):ZoneKind; createCustomZone(id,label,color):CustomZone; isGridWalkable(map,p,radius):boolean; footprintClear(from,to,radius,rect):boolean; wrappers isMapWalkable(map,p,radius), canMoveOnMap(map,from,to,radius) em office-map.
- [x] RED: kind custom/override/common e circle x célula H/V/quina/tangência/percurso.
- [x] Implementar resolução única e normalizar custom.kind no JSON, sem tocar mapas reais.
- [x] GREEN: npx vitest run src/lib/__tests__/map-engine.test.ts e suites map-sync/reset.

### 2. Membership, navegação e recuperação
Files: src/lib/map-navigation.ts, workspace-zones.ts; OfficeScene.tsx, rtc/canonical-zones.ts (geometria pura), testes de navegação/Office.
Interfaces: pointInMapZone(map,id,p), workspaceZonesForMap(map), nearestWalkablePoint(map,p,preferredZone?):Point|null, walkablePointInZone(map,id,anchor):Point|null; recuperação gated pelo fetch inicial e READY.
- [x] RED: zona irregular não contém buraco; custom workspace aparece e common não; posição bloqueada, atualização de versão e posição válida preservada.
- [x] Integrar movimento varrido e fallback de spawn seguro; recuperação usa estado local/sendPos já existentes. Memo de áreas depende do mapa.
- [x] Hover segue células SVG e valida ponto; PlacementLayer usa membership exato. Bounding box mantém apenas card/spotlight visual.
- [x] GREEN: testes novos, map-sync e integração de Office sem desconectar/remontar cena.

### 3. Editor e validador
Files: src/lib/map-validation.ts; MapEditor.tsx; testes puros e integração editor.
Interfaces: validateMap(map):{issues,valid}; issue={severity,code,zoneId,message,cells}; malha de caminhabilidade usa os wrappers da tarefa1, BFS4 sem cortar quinas.
- [x] RED: spawn bloqueado/fora, zona vazia/sem ponto, workspace sem saída, warning permitido e save impedido por erro.
- [x] Reutilizar kind/factory; diagnosticar mapa atual debounced e revalidar no save; pintar bloqueios/zonas/erros e listar áreas.
- [x] GREEN: mapa/editor testes, nenhum save remoto chamado por montar/normalizar mapa.

### 4. Entrega
- [x] Vitest específico e completo, typecheck, build; comparar paths excluídos com base.
- [x] Revisão independente final; uma correção de achados importantes e revalidação.
- [x] Registrar causas/algoritmos/limitações e preparar entrega por commit/push na branch autorizada. Sem SQL/merge/publicação.
