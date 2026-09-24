# Live Jev + confidence sizing — adversarial review

Verdict: **needs-work**. **Do not merge from this review.**

Live mode is not cosmetic. The browser sends a schema-checked desk state to
`POST /api/jev`; that server route reads `TYPESAFE_API_KEY` and calls the real
TypeSafe endpoint with a Choice question (`src/app/api/jev/route.ts:7-24`,
`src/lib/jev/askJev.ts:79-100`). The response parser takes `p` from the selected
option, and the host sizes from that value (`src/lib/jev/askJev.ts:124-151`,
`src/lib/jev/size.ts:22-26`, `src/lib/jev/size.ts:82-101`).

The published TypeSafe OpenAPI matches the endpoint, Bearer authentication,
Choice request, probabilities, and required confidence field. An unauthenticated
probe reached the endpoint and returned 403. This review environment has no
TypeSafe key, however, so no successful authenticated Choice was observed.

## Ordered findings

### 1. High — the authenticated success path is still unproved

All successful Choice tests inject a fake fetch and a fabricated response
(`src/lib/jev/askJev.test.ts:39-77`). The local environment reported
`typesafe_key_configured=false`; only missing-key and malformed route behavior
could be exercised end to end.

The implementation agrees with TypeSafe's current OpenAPI and is clearly a real
server-side call, not a renamed local scorer. That is still weaker than one
captured authenticated response from the deployment and one resulting paper
decision. Do that smoke test before the demo. Until then, a request-contract or
account/configuration problem can make every “Live” cycle fail closed.

Also avoid saying this repository calibrates `p`: it validates and trusts the
probabilities TypeSafe returns. It does not perform local calibration.

### 2. High — `/api/jev` is an unmetered shared-key quota proxy

Every schema-valid POST reaches TypeSafe with the deployment key
(`src/app/api/jev/route.ts:14-23`). Cadence, one-in-flight protection, and 429
backoff live in the browser store (`src/lib/store.ts:370-376`,
`src/lib/store.ts:490-540`), so direct callers and additional tabs bypass the
intended aggregate call rate.

This does not reveal the key, and the fixed question limits what can be asked,
but it can exhaust quota and force the stage demo into repeated 429 waits.
Protect the deployed route or keep the deployment private. A reliable shared
limiter/auth boundary is larger than a review patch.

Related wording issue: the seven-second tape and paper book are assembled in the
`"use client"` store (`src/lib/store.ts:1`, `src/lib/store.ts:330-405`). The
server validates and forwards that client-supplied state; it does not
independently reconstruct the market or book.

### 3. Medium — a same-symbol tape reversal does not invalidate an in-flight Choice

Only one live request may run. New meaningful changes are ignored while it is in
flight (`src/lib/jev/cadence.ts:44-51`, `src/lib/store.ts:370-405`). On response,
the old Choice/features are combined with the current price, current book,
current caps, and a response-time timestamp (`src/lib/store.ts:504-523`,
`src/lib/store.ts:414-455`).

The important safety side is correct: inventory lean and all caps are recomputed
from the response-time book, and settlement is synchronous, so no same-tab
double-fill was found. The demo risk is semantic: a Choice based on tape from up
to the four-second server timeout can fill after that tape has reversed. An age
or signature rejection would be a policy change, so this remains a finding.

### 4. Medium — coin switching still hides and stale-marks open positions

The desk keeps one market stream and preserves the multi-symbol book. Switching
symbols clears active price fields but does not keep the old symbol marked
(`src/lib/store.ts:143-152`, `src/lib/store.ts:598-619`). The HUD shows only the
selected position while equity, unrealized P&L, and gross still include every
position (`src/components/HudStats.tsx:10-35`).

After filling BTC and switching to ETH, BTC's mark freezes. The wall can show a
flat ETH position beside stale nonzero account P&L. Stay on one symbol after the
first fill. Concurrent marks or an all-position panel is outside this review.

### 5. Medium — the busiest tape can suppress Live calls

The intended feature window is seven seconds, but the tick array is also capped
at 500 (`src/lib/store.ts:648-655`). Live mode requires the retained prints to
span at least 1.5 seconds (`src/lib/store.ts:360-361`,
`src/lib/jev/surface.ts:50-53`). Above roughly 333 prints/second, the retained
window can become too short and Live stops asking precisely during heavy tape.

This needs a bounded time-window representation rather than an arbitrary larger
array. For the demo, watch for a readout that stays on “Waiting for a window.”

### 6. Medium — critical store wiring is not integration-tested

The 71 tests cover valuable pure boundaries: TypeSafe parsing, failures, ladder
cuts, lean, caps, cooldown, and the paper book. There is no store, route, or
component integration test in the test script (`package.json:10`).

No automated test drives cancellation through toggle/symbol changes, proves a
single live response creates at most one fill, checks 429 glue, or verifies the
displayed source/model/latency/probability/size together. Those are the highest
regression risks in the shipped path.

### 7. Low — fail-closed rows show a synthetic probability distribution

Failures become a host-created Wait with probability 1 and scores
`{ wait: 1, ... }` (`src/lib/jev/liveJudgment.ts:32-57`). The UI also shows the
fixed failure phrase, no model, latency, and “fail closed,” so it is not silent.
Still, the 1.00 bar is not a Jev probability. During the demo call it a
deterministic host wait, not a model answer.

### 8. Low — 429 backoff compares different clocks

`liveNotBefore` is based on browser `Date.now()`, while call cadence is evaluated
against Binance event timestamps (`src/lib/store.ts:330`,
`src/lib/store.ts:505-509`, `src/lib/jev/cadence.ts:45-51`). Normal synchronized
clocks make this negligible; material clock skew can shorten or lengthen the
backoff.

## Ship blockers and demo footguns fixed in this review

1. A TypeSafe Choice without the OpenAPI-required `confidence` field was
   accepted and could fill. Upstream and host schemas now require a finite
   0–1 confidence; the malformed-body suite covers omission
   (`src/lib/jev/askJev.ts:22-29`, `src/lib/jev/contract.ts:75-85`,
   `src/lib/jev/askJev.test.ts:132-164`).
2. The browser client accepted a valid-looking Choice carried on an HTTP 5xx
   from `/api/jev`. Non-2xx route responses now fail closed before body parsing
   (`src/lib/jev/client.ts:10-20`, `src/lib/jev/client.test.ts:43-62`).
3. A 429 without a usable `Retry-After` resumed normal cadence. It now gets a
   conservative 10-second backoff; valid hints remain capped at 60 seconds
   (`src/lib/jev/askJev.ts:19-20`, `src/lib/jev/askJev.ts:103-109`,
   `src/lib/jev/askJev.test.ts:101-129`).
4. A soft selected act was recorded as Wait using the unrelated Wait-option
   probability, and the row then called the original choice its runner-up. The
   row now retains the selected act's `p` as the reason it missed 0.60 and
   excludes that original choice from runner-up calculation
   (`src/lib/jev/liveJudgment.ts:61-70`,
   `src/components/DecisionFeed.tsx:91-119`).
5. The header's bare “Live” label meant the Binance socket, while the Jev
   readout could combine a fresh tape regime with prior hosted scores and a
   recomputed preview. The header now says “Binance live”; the readout keeps
   model, latency, regime, probabilities, and the actual applied/blocked size
   line from one completed decision (`src/components/Dashboard.tsx:100-109`,
   `src/components/SurfaceReadout.tsx:22-79`).
6. Strategy copy said cooldown prevented another act from being sent. Live Jev
   can still return an act during cooldown; the host blocks its fill. The demo
   script now says exactly that (`STRATEGY.md:41-45`).

## What was verified

- `git fetch origin main`
- `git diff --stat origin/main...HEAD` and `git diff --name-status origin/main...HEAD`
- Full-history secret-pattern scan with `git rev-list --all` + `git grep`: no
  candidate TypeSafe key was found.
- Production client bundle scan under `.next/static`: no
  `TYPESAFE_API_KEY`, TypeSafe endpoint, Bearer token, or fake test secret.
- `npm test`: **71 passed, 0 failed**
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed; `/api/jev` and `/api/jev/health` are dynamic routes.
- Local no-key route smoke:
  - `GET /api/jev/health` → `{"configured":false,"model":"jev-latest"}`
  - valid `POST /api/jev` → closed / `missing-key`
  - malformed `POST /api/jev` → closed / `malformed`
- Published TypeSafe OpenAPI checked at
  `https://api.typesafe.ai/openapi.json`; unauthenticated
  `POST https://api.typesafe.ai/v1/systemone` reached the real service and
  returned 403.
- `gh pr checks`: no CI checks are configured/reported for this branch.

Not verified: a successful authenticated hosted Choice, deployed-route quota
protection, or browser-level rendering. No real exchange order path exists in
this repository.

## Demo script risks

1. Do not demo “Live” until `/api/jev/health` is configured and one authenticated
   Choice has shown a real model id, latency, four probabilities, and a paper
   decision.
2. Use one browser tab on a private/protected deployment. Extra tabs multiply
   TypeSafe calls; direct callers bypass browser cadence.
3. Say “browser builds the desk state; server holds the key and calls TypeSafe.”
   Do not say the server independently reconstructs the tape or paper book.
4. “Binance live” in the header is only the market stream. Hosted judgment
   source is the separate Live Jev / Local surface control and readout.
5. A below-threshold row records Wait while the readout highlights the act Jev
   selected. Say “Jev selected the act; the host rejected it below 0.60.”
6. After the first fill, do not switch coins. Off-symbol positions keep stale
   marks.
7. A failure row's Wait 1.00 is the host's fail-closed output, not Jev certainty.
8. On 429, stop toggling/reloading and wait for the shown service recovery; the
   client honors `Retry-After` or waits 10 seconds by default.
9. If the readout stays on “Waiting for a window” during very heavy tape, the
   500-print cap may have collapsed the retained span below 1.5 seconds.
