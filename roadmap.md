# Office notice UX
- [x] Correct touch camera to visible scene bounds; verify landscape full map and portrait avatar follow with 39 tests and isolated browser captures at 390×844 / 844×390; desktop preserved, no publishing. Physical iPhone and authenticated Office not tested.
## Sprite rendering phase 1
- [x] Separate exact atlas frame selection from fine alignment; remove texture filters and preserve independent ground shadow.
- [x] Evaluate device pixel grid without quantizing logical movement or changing assets (DPR 0.9/1/2; no snapping because ancestor zoom and smooth positioning remain fractional).
- [x] Compare five existing sprites idle/walking in isolated real renderer, scene size and enlarged edge crops; 589 tests passed, automatic preview build OK. Stop without publishing; standalone typecheck result unavailable.
- [ ] Homologate inside the live Office workspace — blocked on the user signing into the preview; requesting user has no matching account for automatic session minting.

- [x] Central bell celebration popup with sender sprite and positive copy, separate from notices.
- [x] Only display/count time in foreground; show pending normally on return.
- [x] Verify popup visuals in isolated browser, closing, focus lifecycle and 575 tests; do not publish.
- [x] Prioritize actions over celebrations and information; cap ordinary stack at three and queue information (all simultaneous actions remain visible even above approximate cap).
- [x] Make area feedback compact, short-lived and replaceable (1.8 seconds).
- [x] Validate refined stack in browser, tests and automatic type safety without publishing.
- [x] Apply positive pending-celebration copy.
- [x] Share visual alignment and stacking across Office notices, accounting for Equipe.
- [x] Validate positioning, actions and relevant tests without publishing (isolated browser checks and full automated suite; no live invitations sent).- [x] Trocar fundo do mapa Halloween pela imagem enviada
