# Office notice UX
## Anonymous Auth hardening homologation
- [x] Protect canonical workspace owner with incremental 0009; 0008 unchanged. Connected rollback-only tests passed for owner/admin/member denial, privileged trigger denial, ordinary removals and workspace cascade.
- [x] Run connected rollback-only workspace creation and normal invitation/RPC tests: passed with simulated database claims, not signed-in Auth/API/UI. Existing authorized creator requires global admin role.
- [x] Reaudit anonymous/visitor/member permissions; 82 files / 866 unit tests passed, automatic typecheck exit 0 and preview build OK. No publication; original 1 workspace / 17 memberships / 0 invites / 0 visitors retained.
- [ ] Visitor profile read regression: active visitor cannot read member profiles because the SELECT policy's membership subquery is RLS-filtered. Recorded as publication blocker; visitor changes excluded from this task.
- [ ] Authenticated workspace creation/invitation and actual LiveKit V1/V2/TURN checks: UNVERIFIED without a signed-in session; no automatic authentication permitted. SQL tests do not verify HTTP bearer handling.
- [x] Partial visitor database checks exercised activation/runtime/session, claim/prop/Chat denial and Meeting rejection; expiry/revoke and outsider membership/profile/group/claim/prop/session denial passed in a separate rollback test. Synthetic visitor has no auth.users row, so position writes and onboarding are unverified.
- [ ] Full visitor onboarding/runtime/two-person visual check: requires signed-in manual sessions; do not mint other users' sessions.
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
