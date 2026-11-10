# Effect system build plan

## TARGETING — what's left to finish it (audited 2026-11-09, against `cda568a` + working tree)

**Supersedes the 2026-11-09 "skeleton" status and rung 3 below where they differ.**

What exists: singular `CHOOSE_TARGET { playerId, instanceId }`; `applyChooseTarget` only pushes the
pick; `executeResolution` re-derives the remaining capacity from `selected` on every pass (a
`structuredClone` of the expression, `decrementCapacity` per pick) and sets `EFFECT_TARGET` while any
candidate passes `isValidSelection`; the stepper holds the cursor while a decision point is set;
`genChooseTargets` offers every `evalTargetExpression` candidate and `getLegalActions` filters them
through `validate`. Termination is already "zero candidates", the ceiling is already
`weight <= remaining`, and a negative remaining already throws (old items 1 and the nits about
`captureSnapshot`, the `evaluator.ts` cycle and the duplicate `ADD_TO_HAND` are done).

**Suite is green (305 pass / 4 todo) — but the targeting loop is not exercised by any test (see C).**

### A. Fix the skeleton (do first — small)

1. **`clearSelectedTargets` runs on the PAUSE path too.** It moved out of `executeResolution` (good —
   that fixed the 5 `DRAW` unit tests), but into the `RESOLUTION` case, which runs *before* the
   `if (state.decisionPoint) return` guard. So every pick that leaves candidates is wiped the moment
   the next prompt is raised. Capacity 1 works by luck (the pick exhausts it, the op runs, then the
   clear). Capacity ≥ 2 loops forever: each pass sees only the latest pick, capacity never drops below
   N−1, and already-picked cards are re-offered. **Fix: clear beside `advanceEffectCursor`, after the
   guard** — i.e. only when the step completes. That also covers `PAYMENT` for free (item 17).
   Also drop the now-unused `clearSelectedTargets` import in `resolution.ts`.
2. ~~`executeResolution` reads `state.currentEffect!` in the choice branch~~ — done, uses the parameter.
3. **`REST` is an empty `break`.** A card authored with `REST` today resolves to nothing, silently,
   and clears `selected`. Throw "not yet implemented" until the arm is real — same rule as the stepper.
4. **`validate` throws on an unknown `instanceId`** instead of returning a string:
   `isValidSelection` → `captureSnapshot` throws. Check the instance exists before calling it.
5. **`isValidSelection` reads `state.currentEffect.selected`** rather than taking the picks as an
   argument. Fine for now; becomes wrong the first time a *payment* selects while a resolution's
   `selected` is live, or when per-pick feasibility (PAY-6) needs to ask "what if I also picked X".

### B. Make targeted operations actually do something (rung 2 + rung 3 payoff)

6. **One binding resolver for all three target kinds** → writes `selected` (shape decision 2):
   `SELF_TARGET` → `[source]`, `SELECTOR_TARGET` → `evalTargetExpression`, `PLAYER_CHOICE_TARGET` →
   the picks. The operation arms then read only `selected`, never the expression.
7. **Decide what an omitted `target` means** on `REST`/`KO`/`TRASH`/`ADD_TO_HAND`/`RETURN_DON`
   (`target?` is optional on all of them). Either default to `SELF_TARGET` or make it required — not
   "whatever the arm happens to do".
8. **Operation arms**, each grouping the binding by `getCardInstance(state, id).controller` and
   applying per group (the operations validate ids against one player's zone):
   - `REST` → `cardsSetRested`
   - `KO` → `removeCardsFromField(..., K.O., ...)` — **lands with the On-K.O. `activeZone: TRASH`
     change and the `_removeCardFromField` emit reorder** (CLAUDE.md: silent staging otherwise)
   - `TRASH` → `_cardsMoveToTrash` from the card's *own* zone (hand vs field differ; field must go
     through `removeCardsFromField` with method TRASH, not a raw move)
   - `ADD_TO_HAND`, `RETURN_DON` — after the three above
   - **Empty binding = no-op, skip the call.** `removeCardsFromField` throws on `[]`, and "K.O. 1"
     against an empty board must fizzle, not crash.
9. **Return `{ state, outcome }`** from the new arms (shape decision 1) so `PriorActionResolved` /
   `bind` have something to read later. Don't retrofit `cardsDraw`.
10. **Author real cards in `src/cards/`**: one SELECTOR ("rest all opponent Characters"), one CHOICE
    ("K.O. up to 1 opponent Character with cost 3 or less"), tested through `reducer` against the
    registry.

### C. Tests — none exist for targeting yet

11. In priority order:
    - **The hang invariant**: the driver always either sets a DP or completes the step. Write this
      first; it is the one failure that produces no error.
    - zero candidates → no prompt, step completes, effect fizzles
    - one pick → prompted, picked card is affected, `selected` is `null` afterwards
    - **multi-pick (`CARDS` capacity 2) → two prompts, already-picked card not re-offered, and
      `selected` holds BOTH picks while the second prompt is open** — this is the test that catches A1
    - `WEIGHTED` → offered set narrows as remaining drops; weight-0 card still offered at remaining 0
    - `chooser: "OPPONENT"` → DP goes to the opponent; the controller's `CHOOSE_TARGET` is rejected
    - `validate` rejects: wrong player, off-filter card, wrong zone, already picked, unknown id
    - `getLegalActions` at `EFFECT_TARGET` ≡ the set `validate` accepts
    - the clone: `state.definitions` / the step's expression capacity is unchanged after a pick

### D. Payment-side selection (blocked on the `PAYMENT` stepper arm)

12. **Min feasible at payment ENTRY → `DefinitionError`** (old item 3). Payment only.
13. **Min satisfied at payment CLOSE → `DefinitionError`** (old item 4) — catches PAY-6 stranding.
14. **Resolution absorbs** (old item 5): neither check runs for a `RESOLUTION` step. `CARDS.min` is
    therefore read *only* by payments — note it on the type.
15. **Affordability gate** (old item 6) derived from the payment's own `TargetExpression`
    (PAY-2). Blocked on the requirement-kind split (PAY-1).
16. **Per-pick feasibility** (PAY-6) — a pick that strands the rest of a weighted/overlapping cost
    must not be offered. Currently stubbed always-true.
17. The validator already accepts `CHOOSE_TARGET` on a `PAYMENT` step; nothing can reach it yet.
    Clearing at cursor advance (A1) covers the payment path too.

### E. Later / tabled

18. **Early stop** (rung 5, "up to N") — TABLED. Needs a stop action + a `closed` marker that
    `executeResolution` reads alongside zero candidates; fill-to-exhaustion tests will need revisiting.
    Until then `min` is inert and "up to N" over-picks.
19. **Non-`LITERAL` capacities** — `decrementCapacity` throws on anything else. Needs the capacity
    *evaluated once* at step entry (frozen) and then decremented, or "K.O. up to X where X = DON" moves
    under the player mid-selection.
20. **"Cannot be chosen" protection** — a targeting-only exclusion, distinct from "cannot be K.O.'d"
    (see Targeting → two kinds of protection). Goes in `isValidSelection`, not the filter.
21. **Cross-step bindings** (`bind` / `REF`, `PriorActionResolved`, 28 cards) — `selected` is wiped at
    step completion, so "K.O. 1. If you do, draw 1" needs the outcome bound into `locals`.
22. **Web client** — `apps/sleapy-web` has no handling for `EFFECT_TARGET` / `CHOOSE_TARGET`; a game
    reaching one in the UI is stuck.

---

## NEXT ACTIONS — 2026-11-07

**Read this first. Four commits, in order. Nothing below is in progress; the working tree is docs only.**

**0. Commit the docs.** `EFFECT_PLAN.md` modified, `EFFECT_INVARIANTS.md` **untracked**, plus a
whitespace-only change in `types/expression.ts`. All design, no code. Do this before anything else so
the session's conclusions are not sitting in an uncommitted tree.

**1. Make cost a SUBSET of `EffectOperation`, not a merge.** Move the seven cost members into
`EffectOperation` (reconciling `RETURN_TO_HAND` against `ADD_TO_HAND` — the only non-mechanical call),
then derive the cost type so `PaymentStep` cannot hold a `LOOK`:

```ts
const COST_TYPES = ["REST", "TRASH", "RETURN_TO_HAND", "RETURN_DON",
                    "LIFE_TO_HAND", "LIFE_TRASH", "LIFE_FLIP"]
                   as const satisfies readonly EffectOperation["type"][];
export type CostOperation = Extract<EffectOperation, { type: typeof COST_TYPES[number] }>;
```

`PaymentStep.cost: EffectCost` → `PaymentStep.operation: CostOperation`. Costs are a PROPER subset —
`LOOK`/`REORDER`/`DRAW`/`ADD_TO_HAND` can never be paid — so a flat merge would lose a real
restriction. The `satisfies` clause is load-bearing: a bare `Extract<…, { type: "REST" | "TYPO" }>`
silently DROPS the mistyped member instead of erroring. It also yields a runtime array the effect
validator can use, and `COST_TYPES` becomes the explicit, reviewable statement of which verbs are
payable — adding an operation does not silently make it a cost.
Contained: nothing reads `EffectCost` today and `PAYMENT` throws from the stepper.
*Do this BEFORE rung 2* or you write `REST`/`TRASH` twice and then deduplicate.
**Done when:** it typechecks and 305 tests still pass.

**2. Rung 2 — "Rest all your opponent's Characters."** No decision point, no stepper changes.
- `evalTargetExpression` — `SELF_TARGET` → `[source]`, `SELECTOR_TARGET` → zones × filter. **Pure.**
  Return a discriminated result (`RESOLVED` vs `CHOICE`) so the choice arm has somewhere to land later.
- `REST` / `KO` / `TRASH` on `EffectOperation` with inline `target`.
- their `executeResolution` arms over the existing `cardsSetRested` / `removeCardsFromField` /
  `_cardsMoveToTrash` — **group the binding by `getCardInstance(state, id).controller` and apply per
  group**, since those operations validate ids against one player's zone.
- one authored card in `src/cards/`, tested through the reducer.
- **Carry the two shape decisions** (see the rung 2 note below): operations return
  `{ state, outcome }` so a caller can read what was applied; `selected` holds the resolved binding for
  **all** target kinds, not only `PLAYER_CHOICE_TARGET`.
- **NOT a third carry:** an explicit `completed | paused | failed` step outcome was proposed and
  **rejected 2026-11-07**. Pausing is implicit in `state.decisionPoint` being set, suspension is
  implicit in the replacement queue being non-empty, and payment failure is `applied < min` computed
  locally in the stepper's payment arm. The rule is just **advance the cursor unless the step left a
  reason not to** — see the pause rule under Targeting.
**Done when:** a real card rests both opponent Characters through `reducer(state, PLAY_CARD)` in one call.

**3. Rung 3 — "K.O. 1 opponent Character."** All of the decision-point work, together, because none of
it is independently testable. Reshape `CHOOSE_TARGETS { instanceIds[] }` → singular `CHOOSE_TARGET`;
build the `constraint` payload as the **derived projection** (candidates, picks, accumulated, capacity,
stillNeeded, stopAllowed, weight?) with `validate`/`actionGen` reading **only** it; the selection driver
that sets the DP; `genChooseTargets`; validate + apply; the **pause rule** in the stepper; writes to
`selected`; loop close resetting to `null`; the re-entrant consume.
**No `isForced` / auto-resolve** — dropped 2026-11-07, a harness collapses single-action nodes itself.
Zero candidates still completes silently (a DP no action can answer is a deadlock).
**Done when:** the player is prompted, picks one Character, and it is K.O.'d — and a zero-candidate
board fizzles with no prompt.

### Invariant to assert while writing step 3
The driver must **always** either set a decision point or complete the step. Doing neither while
holding the cursor makes `advance` spin forever with no decisionPoint and no winner — **a hang, not a
throw.** It is the one failure in this loop that produces no error message, so test it first.

---

## Where things stand — 2026-11-07

**305 pass / 4 todo across 20 files. Engine typechecks clean.** Verified against the code, not inferred.

Working end to end:

- **The On-Play draw slice.** `reducer(state, PLAY_CARD)` runs staging → commit → promotion →
  `advanceEffect` → `executeResolution` → `cardsDraw` → `MAIN_ACTION` in one call. Two real cards
  (`OP04-045`, `OP13-041`) in `src/cards/`, tested against the real registry.
- **The subject channel** (milestone 1). Snapshots captured pre-mutation, carried on the signal,
  filtered by `SubjectMatch`, stored on the `EffectContext`, read by `SUBJECT_COUNT`.
- **Two-tier activation** (1b). `SignalPredicates` then `SubjectMatch`, `selectSubjects` owning the
  `null` / `[]` / non-empty contract. Phase-keyed effects stage.
- **Effect ordering** (milestone 4). `CHOOSE_NEXT_EFFECT` carries `(index, instanceId, effectId)`;
  `selectQueuedEffect` is shared by `validate` and the apply so a valid action cannot fail to apply.
  `effectOrder.test.ts` verified to bite — mutating the index lookup fails 6 of its 8 tests.
- **The corpus survey** (milestone 3). ~78 atoms over 2,316 effect-bearing cards; see "Corpus survey"
  below. It has already settled one live design question and reordered the roadmap.
- **The boolean expression layer.** `BoardCondition` renamed to `Condition`, `ZONE_SIZE` replaced by
  `COMPARE` (two amounts + an operator, so relational comparisons and existence checks both fall out),
  stat filters split into computed/base pairs, `evalCondition` written and tested. `assertNever` on the
  reducer switch. **The read side is still missing** — `def.condition` is written to the
  `EffectContext` and never evaluated, so a card authored with a condition silently resolves
  unconditionally. That is milestone 5, and it is small.

Still stubbed, confirmed by grep:

| what | where |
|---|---|
| `CHOOSE_TARGETS` throws | `reducer.ts:84` |
| `ACTIVATE_EFFECT` throws; `genActivateEffect` is an empty function | `game/actions/main.ts:57` |
| `REQUIREMENT` / `PAYMENT` steps throw | `game/effects/stepper.ts:32` |
| `LOOK` / `ADD_TO_HAND` / `REORDER` throw | `game/effects/resolution.ts:48` |
| no `REST` / `KO` / `TRASH` operation exists at all | `EffectOperation` has 4 members |
| `evalTargetExpression` — **does not exist** | nothing can resolve a target |
| `evalCondition` exists but `def.condition` is never read | `game/mechanics/effects.ts:25` writes it, no one evaluates it |
| `EFFECT_TARGET` decision point is **never set** | declared in `state.ts:18` with `constraint: null`; routed in `validator.ts:19` / `actionGen.ts:166`; zero setter sites |
| `genChooseTargets` is an empty function | `actionGen.ts:118` |
| `oncePerTurn`, `optional` | never read |
| `SUBMIT_REORDER` throws explicitly | was a silent fall-through; `assertNever` surfaced it |

---

# What's left, in order

**This section is the roadmap. Everything below it is rationale.**

## The ladder — one axis, one rung at a time

Each rung ships an authorable card shape and adds one thing to a loop that already works. The order
follows the survey's own recommendation: body primitives by frequency first, combinators second.

| rung | ships | new machinery |
|---|---|---|
| 1 | `DRAW` | ✅ done |
| **2** | **"Rest all opponent Characters"** | `evalTargetExpression` (SELECTOR + SELF only), `REST`/`KO`/`TRASH` operations with inline `target` |
| 3 | "K.O. 1 opponent Character" | `EFFECT_TARGET` payload, the stepper pause rule, `CHOOSE_TARGET` through gen/validate/apply/reducer |
| 4 | "Trash 2 cards from hand" | accumulation — the loop actually loops; canonical ordering stops being vacuous |
| 5 | "Trash up to 2 cards" | `min: 0`, the stop action, `stopAllowed` |
| 6 | "Trash Characters totalling cost 4" | `CardStatType` weighting; weighted `remaining` narrows the offered set — the only rung where it does |
| 7 | `LOOK` + `REORDER` | the `look` zone flow, plus the missing `SUBMIT_REORDER` reducer case |

**Rung 2 is next.** Every operation it needs already exists (`cardsSetRested`, `removeCardsFromField`,
`_cardsMoveToTrash`) — it is adapter work in `executeResolution`, not new game logic. One wrinkle: those
operations take a `playerId` and validate ids against *that player's* zone, so a target set spanning
both boards must be grouped by `getCardInstance(state, id).controller` and applied per group.

**Two shape decisions to carry INTO rung 2** — both independently justified, both expensive to retrofit
(see "Replacement is a rewriting system" for what they leave room for):

1. **New targeted operations return `{ state, outcome }`**, not bare `GameState`. Justified without any
   replacement in the picture by `PriorActionResolved` (*"K.O. 1 Character. If you do, draw 1"*, 28 cards)
   and by `bind`, which writes exactly that value. Don't retrofit `cardsDraw` and friends.
2. **`selected` holds the resolved binding for ALL target kinds**, not only `PLAYER_CHOICE_TARGET` —
   "target all" is the same as clicking every target. Makes `selected` mean "the binding this step
   operates on" rather than "what the player clicked", which is the more useful invariant and the one
   that lets one comparison serve all three kinds.

~~Also carry an **explicit step outcome** (`completed | paused | failed`).~~ **REJECTED 2026-11-07 —
there is no pause field and never was.** The pause rule is a GUARD, not state: `advanceEffect` advances
the cursor *unless the step left a reason not to*, and today
[stepper.ts:37](src/game/effects/stepper.ts) advances it **unconditionally**, so the whole fix is

```ts
if (!state.decisionPoint) state = advanceEffectCursor(state);
```

Each reason the explicit outcome was meant to carry is already readable where it is needed: *paused* from
`state.decisionPoint`, *suspended* from a non-empty replacement queue (a second clause on the same
guard), and *failed* from `applied < min`, which the stepper's payment arm computes locally from the
operation's returned `applied` and the step's own `min` — it is never reported upward. Operations
returning `{ state, outcome }` still stands, but on its own merits (`PriorActionResolved`, `bind`), with
no pause logic attached.

**`locals` is not needed until rung 7 or later.** A paused selection lives in `EffectContext.selected`;
the operation reads it directly on resume. The binding channel (`EffectValue`, `bind`/`REF`) is only
required when a selection must outlive its own step — cross-step references like *"K.O. 1 Character. If
you do, draw 1"* (`PriorActionResolved`, 28 cards).

## Parallel axis — status effects, and it is the bigger one

The ladder above is the **targeting** axis. The survey's second-largest atom is `+Power` at 427, and
**status-with-duration is 1,162 cards** across 9 duration atoms (`ThisTurn` 447, `ThisBattle` 191).
None of that machinery exists, and no rung above gets closer to it.

`Rest` is an operation (a permanent state change until refresh); `+Power ThisTurn` is a status. Do not
let the second hide behind the first.

## Then, by survey frequency

| | cards | notes |
|---|---|---|
| **Invoked abilities** | ~635 (`Activate: Main` 363 + `Main` 272) | `ACTIVATE_EFFECT` throws, `genActivateEffect` is empty. Bigger than it looks |
| **`oncePerTurn`** | 290 | Storage and reset already wired; only the mark and the gate are missing. Needs the consumption boundary (invariant 3), and the gate has two homes — `genActivateEffect` and the staging gate — which must share one predicate |
| **Payments** | 599 optional costs | Depends on targeting: `EffectCost.target` is a `TargetExpression` |
| **Conditions** (m5) | `LeaderTrait` 245 is the single most common body condition | `evalBoardCondition` + wiring `def.condition` at resolution. `ZONE_SIZE` must be **replaced** by a compare leaf over two `AmountExpression`s. **Delete** the commented stub at `emitter.ts:50` — wrong place |
| **ChoiceStep** | 14 (`Modal(ChooseOne)`) | The modal keystone, and the reason optional payment stays a flag rather than a branch |

## Independent — slot in anytime

- **`tsconfig.json` for `packages/engine`.** Tests are **never typechecked**: the engine has no
  tsconfig and `apps/sleapy-web` includes only its own `src`. This has now bitten twice — two
  conditional types silently resolving to `never`, and `makeEffectContext` shipping without a required
  field. Will surface existing errors, so give it its own change.
- **Collapse `EffectCost` into `EffectOperation`** — see Structural below. Cheapest *before* rung 2
  adds `REST`/`TRASH` to `EffectOperation` beside the `REST`/`TRASH` that `EffectCost` already has.
- **`lit()` in `src/cards/authoring.ts`** — `{ kind: "LITERAL", value: n }` is spelled out inline in
  both authored cards. Wrap stable leaves only; a helper over a shape still in flux would absorb the
  compile errors that hand-written TS exists to surface.
- **Battle abandonment guard** — rule settled below, not built. Two holes: `conductor.ts`'s `BLOCKER`
  non-null assertion, and `resolveBattle`'s class-only "corrupt" check that a trashed character passes.
- **Rename `activate` → `invoke`**; never "trigger".
- **Milestone 2** — playing into a full character zone routes through `displaceCard`. Untested path.
- **Rename `EffectContext` → `ActivatedEffect`**, optional.

## Dropped, not deferred

- **Roles / a third activation arm.** Combat is phase-keyed by decision. The survey backs this: 308
  battle-keyed cards, so it is a major cluster served by phases rather than a corner case papered over.
- **The remaining signal migration.** Nothing left to convert. `selectSubjects`' throw is a permanent
  design assertion, **not** a tracker.
- **6b prevention / replacement** — 72 cards, the smallest axis and the hardest to build. Dropped from
  the *build* order only; the design is now substantially settled under "Payment failure, replacement,
  and outcome reporting (2026-09-26)", and two of its consequences (the `paused` second disjunct, the
  third `selected` position) are cheap to accommodate while writing the selection loop and expensive to
  retrofit after.

---

# Corpus survey — milestone 3, 2026-08-16

**2,631 cards; 2,316 with effect text; 315 vanilla.** ~78 atoms across six axes. **97.7% of
effect-bearing cards are fully expressible in this vocabulary; 54 need a new primitive** — that
near-closure is what de-risks the data-driven DSL bet.

Top atoms by cards-in-which-they-appear:

- **Signals** — `On Play` 848 · `Activate: Main` 363 · `Main` 272 · `When Attacking` 246 · `Counter`
  184 · `On K.O.` 154 · `End of Your Turn` 50 · `On Opponent's Attack` 48 · `Trigger` 24 · `On Block` 14
- **Body actions** — `Rest` 609 · `+Power` 427 · `KO` 412 · `DeckPlacement` 399 · `Trash` 348 ·
  `Draw` 281 · `LifeManipulation` 247 · `AddToHand` 233 · `PlayCard` 228 · `RevealFromDeck` 210 ·
  `LookTopN` 204 · `SetActive` 180 · `GrantKeyword` 146 · `-Power` 132 · `Modal(ChooseOne)` 14
- **Costs** — `TrashFromHand` 184 · `ReturnDON` 158 · `RestSelf` 122 · `RestDON` 102 · `TrashSelf` 59.
  **599 costs are optional (`You may …`); 290 effects are `[Once Per Turn]`**
- **Body conditions** — `LeaderTrait` 245 · `Opponent-state` 142 · `BoardState(self)` 92 · `DON-state`
  82 · `LifeCount` 80 · `LeaderName` 62
- **Durations** — `ThisTurn` 447 · `ThisBattle` 191 · `PlayedTurnAttack` 66 · six more
- **Keywords** — `Blocker` 352 · `Rush` 86 · `Double Attack` 32 · `Banish` 22
- **Framework rollup** — Signal 2,024 · Status 1,162 · Replacement 72

**What it settled immediately:** optional payment stays a **flag** (`PaymentStep.optional`) rather
than becoming a two-branch `ChoiceStep` — 599 cards against 14 modal ones, and forcing six hundred
cards through labelled branches with explicit gotos and correctly-chosen terminals to share a
mechanism with fourteen is the wrong trade.

**What it reprioritised:** `oncePerTurn` from a late item to 290 cards · status/durations from the
bottom of a table to the largest unbuilt subsystem · invoked abilities from an afterthought to ~635
cards · battle-keyed effects confirmed as a major cluster, validating the phase-keyed decision ·
replacement confirmed as the smallest axis, justifying 6b's deferral.


# Shipped — 2026-08-07

Condensed; the durable rationale lives in the settled-decisions sections below and in the code.

- **Subjects move onto signals as pre-mutation snapshots.** `CardSnapshot` + `captureSnapshot`;
  `evalCardFilter` takes a snapshot as its universal input so activation and live evaluation share one
  path. Converted: `CARDS_SENT_TO_{TRASH,HAND,DECK,LIFE,LOOK}`, `CARD_SENT_TO_TRIGGER`,
  `{CHARACTER,STAGE,EVENT}_PLAYED`, `CARD_REMOVED_FROM_FIELD`. `signalSubjects` **deleted**.
- **`_removeCardFromField`'s DON-detach loss fixed** — one capture at the head of the operation feeds
  both signals, pinned by a test asserting the subject reports 5001 power while live state reports
  5000.
- **`EffectRef` deleted**, collapsed into `EffectContext` built once at staging. `steps` was already a
  reference into the immutable definition, so the "cheap" form saved no allocation and promotion had
  to construct the real object anyway. `promoteEffect` now splices by object identity — computing the
  index against `state`, never `draft`, since immer proxies drafted elements.
- **1b**: `SubjectMatch`, `SignalPredicates` (incl. `phase`), `SignalActivation` discriminated on
  `Extract<GameSignal, { subjects }>`, `selectSubjects`, tier reorder, gate/payload split.
- **Emit ordering at the three early sites is UNCHANGED, deliberately.** Normalising it requires
  re-authoring On-K.O. to `activeZone: TRASH` in the same change — see the corollary under 6a.
# The plan — milestones and why

*Rationale, not sequencing. "What's left, in order" above is the roadmap; these sections explain why
each milestone exists and record what was decided while building it. Milestone NUMBERS are stable
identifiers, not an order — 6a shipped before 1a, and 1b before 4.*

## 1. Give effects access to their subject — **COMPLETE, 2026-08-07**

Both halves shipped. An effect now knows what it activated on, as a snapshot taken before the mutation
that caused the signal. Baseline **276 pass / 0 fail**, engine typechecks clean.

The read side, finishing 1a: `EvalContext.subjects?` (optional — absent means "no activating signal in
scope", which is not `[]`), threaded by `evalContextOf`, read by a bare `SUBJECT_COUNT` leaf on
`AmountExpression` that **throws** when subjects are absent rather than answering `0`.

`subjectCount.test.ts` runs the driving card end to end — pre-mutation capture, a multi-subject
batched signal, `causeKind` + `source` + `fromZone` narrowing together, `ANY_OF` filtering, subjects
onto the context, `evalContextOf` threading, `SUBJECT_COUNT`, `DRAW`. Verified to bite: deleting the
one line in `evalContextOf` fails three of its tests with the "no activating signal in scope" throw.
The card is hypothetical and lives in the test rather than `src/cards/`, since no real card id prints
that text.

Kept honest: one test asserting a mixed-controller trash batch was **removed** — `_cardsMoveToTrash`
validates every id against a single player's zone, so that batch is unreachable and the test was
vacuous. Replaced with an opposing copy of the same card declining to activate, which exercises the
same `CONTROLLER`-resolves-against-the-listener pairing through a reachable path.

### Original writeup below *(1a paused behind 6a, 2026-08-07)*

**Why:** an effect currently knows *that* it activated but not *what it activated on*. That is the
missing half of every reactive effect — any card saying "that character", "those cards" or "for
each" is unwritable until the matched subject set survives past the staging gate. The gate is
currently the only thing that ever sees it.

Immediate payoff: counting ("draw 1 for each card trashed"). Larger payoff: targeting, which reads
the same channel through a different expression type.

Driving card (hypothetical): *"When a {Navy} card trashes cards from your hand by an effect, draw 1
card for each card trashed."*
```ts
activation: [{
    signal: "CARDS_SENT_TO_TRASH",
    subject: { kind: "ANY_OF", filter: { kind: "CONTROLLER", controller: "SELF" } },
    causeKind: ["EFFECT"],
    source: { kind: "TYPE", cardType: "Navy" },   // "Navy" is a real type string in the card data
    fromZone: ["HAND"],
}],
steps: [{ kind: "RESOLUTION", operation: { type: "DRAW", amount: { kind: "SUBJECT_COUNT" } } }]
```

### 1a. Plumb the channel — resumes after 6a's first category lands

The consumer chain from the signal to `SUBJECT_COUNT`: stage → ref → context → evalContext →
evaluator. Written against `CardSnapshot[]` directly, since 6a lands first and there is no id stage
to alias around.

- [x] ~~`signalSubjects` returns `instanceIds` for the five `CARDS_SENT_TO_*` signals~~ — subsumed by
      6a, which deletes the function
- [x] `matchesActivation` returns `CardInstanceId[] | null`; emitter flatMaps + dedupes into
      `matchedSubjects` and passes it to `stageEffectRef`. **Element type becomes `CardSnapshot` in
      6a**, and the `evalCardFilter` call at `emitter.ts:86` changes with it.
- [ ] `stageEffectRef` — param exists, not yet written onto the ref object
- [ ] `EffectRef.subjects` / `EffectContext.subjects` types — REQUIRED, `[]` legal. Coherent because
      of STAGE-ONCE: one ref per event regardless of subject count, so there is always exactly one
      array to fill.
- [ ] `buildCurrentEffect` copies ref → context
- [ ] `EvalContext.subjects?` — **optional, and that is load-bearing.** Absent means "no activating
      signal in scope", which is NOT "the signal named nothing". Two callers are legitimately
      signal-less: the staging gate (mid-decision about what the subjects even are) and
      `StatusEffectDef.affects`. Handing those `[]` makes `SUBJECT_COUNT` answer `0` instead of
      reporting that the question was unanswerable.
- [ ] `evalContextOf` threads it — easiest to miss, fails silently
- [ ] `AmountExpression` gains `SUBJECT_COUNT`; evaluator branch throws when subjects absent
- [ ] ~~STALE TEST: `staging.test.ts > signalSubjects > "throws for a multi-card signal"`~~ — **delete
      it with `signalSubjects` in 6a** rather than fixing it. It is the one red in the current
      baseline (259 pass / 1 fail), and it will stay red until 6a removes the function it pins.

**BROKEN BUILD, fix on the way into 6a.** `evaluator.ts:113` already has a `case "SUBJECT_COUNT"`
that `AmountExpression` has no member for — TS2678 plus TS2339 on `expression.value`. The engine has
no typecheck of its own, so this only surfaces in the web build. It is a placeholder that recurses
without ever reading subjects. **Revert it**; do not leave a non-compiling stub sitting through 6a.

### 1b. Split the gate from the payload — **DONE 2026-08-07**

Shipped: `SubjectMatch` (`ANY_OF`/`ALL_OF`), `SignalPredicates` (the tier-1 bag, now including `phase`),
a `SignalActivation` discriminated structurally on `Extract<GameSignal, { subjects }>`, and
`selectSubjects` owning the `null` / `[]` / non-empty contract. `signalSubjects` is **deleted** — its
three cases live in `selectSubjects`. Tier 1 now runs before tier 2. Baseline **269 pass / 0 fail**.

**Phase-keyed effects now stage**, which was the whole point. `BattlePhase` already had
`WHEN_ATTACKING` / `ON_OPPONENT_ATTACK`, so the design was anticipated in the type.

**BATTLE IS DELIBERATELY NOT MODELLED, decided 2026-08-07.** Combat signals name cards in several
roles, so they carry no `subjects` and land in the subject-less arm; `selectSubjects` throws if a card
listens for one. **That throw is a permanent design assertion, not a migration TODO.** "When
attacking" and "on opponent's attack" are PHASE-KEYED — they watch a battle phase through the `phase`
predicate and read `state.currentBattle` at resolution. "On opponent's attack" queues every listener
into one staging frame, which is what the frame is for. The third activation arm (role-filtered
subjects over named `CardSnapshot` fields) is designed but NOT built; add it only if a real card
proves it necessary. Do not "fix" the throw by pushing combat into the flat-subjects arm.

Multi-listener battle abilities will deadlock until milestone 4 — two effects in one frame sets
`RESOLVE_EFFECT_ORDER` and `CHOOSE_NEXT_EFFECT` still throws.

**Found while doing this: engine tests are NEVER TYPECHECKED.** The engine has no tsconfig, and
`apps/sleapy-web` only includes its own `src`, so engine files are checked transitively — but nothing
imports `__tests__`, and vitest strips types without checking. Two conditional types written in a test
helper silently resolved to `never` and nothing complained. Worth a `tsconfig.json` in the engine.

#### Original writeup (superseded by the above)

**One filter, two consumers**: the gate reads its *cardinality*, the payload reads its *extension*.
Today they are the same operation — `matched.length === 0 → null` (`emitter.ts:87`) — so "activated,
carries nothing" is unrepresentable, which is why subject-less signals can never stage.

Splitting it needs the `SubjectMatch` wrapper (see settled decisions), and the wrapper's membership
depends on 6a. **Do not build a `NONE` member**: it is exactly what subjects-on-signals deletes, and
building it means authoring it onto every phase-keyed card and then removing it.

Cost of waiting: phase-keyed effects stay blocked until 6a lands. Accepted.

## 2. Close the On-Play slice

**Why:** so "the slice works" has no asterisk. One untested path: playing into a FULL character zone
routes `CHARACTER_PLAYED` through `displaceCard` rather than `playCharacter`, after a removal. A full
board is an ordinary mid-game state.

## 3. Let the language be shaped by the cards — **COMPLETE, 2026-08-16**

**Why:** every card examined had forced a language change, and that continues as long as requirements
arrive one card at a time. Survey the corpus, cluster by keyword and verb, convert reactive design
into informed design.

**Done.** Results and consequences under "Corpus survey" near the top. It paid off immediately by
settling optional-payment-as-a-flag (599 cards vs 14) — the first time a design question was answered
by counting rather than by argument — and it reordered the roadmap around `oncePerTurn` (290),
invoked abilities (~635) and status/durations (1,162).

## 4. Let two effects coexist — **COMPLETE, 2026-08-16**

**Why:** two cards watching one signal is an ordinary board and used to **hard-stop the game** — the
conductor sets `RESOLVE_EFFECT_ORDER`, and `CHOOSE_NEXT_EFFECT` threw in validator/reducer/actionGen.

**Shipped.** `CHOOSE_NEXT_EFFECT` carries `(index, instanceId, effectId)`. `index` is the key because
`(instanceId, effectId)` is **not unique** — one effect stages twice in a frame when it listens for two
signals that both fire during one action, and those contexts carry different subjects, so they do not
resolve identically. The ids ride alongside as a consistency check, turning a stale index into a loud
rejection rather than a silent wrong pick. `selectQueuedEffect` in `mechanics/effects.ts` is the single
implementation shared by `validate` (returns the string) and the apply (throws it), so an action that
validates cannot fail to apply.

`effectOrder.test.ts` — 8 tests, most of which never name a field on the action: they take actions
from `getLegalActions` and hand them back to `reducer`, so they survive further shape changes.
Resolution order is read from `gameLog` via `cause.sourceId`, because with only `DRAW` implemented the
final board is identical whichever order ran. Verified to bite: mutating the lookup to ignore the index
fails 6 of 8.

Also the first test file to call `getLegalActions` at all — previously exercised by zero tests.

~~Forces the **EffectRef identity bug**~~ — **half fixed 2026-08-07 by collapsing `EffectRef` into
`EffectContext`.** `promoteEffect` no longer matches on `instanceId`; the queued object IS the object
that resolves, so it splices by object identity and cannot mis-select between two effects on one card.
`EffectRef.cardId` went with it (it was derivable via `getCardDef`).

What REMAINS for this milestone: `CHOOSE_NEXT_EFFECT` carries only `{playerId, effectId}` and still
cannot name an instance, so the player-facing selection path needs the composite `(instanceId,
effectId)` key even though the internal one no longer does.

## 5. Let effects be conditional

**Why:** most printed effects have an "if". Without it every effect that activates must resolve, so
the whole class of "draw 1 if you have 8 or more DON!!" is off the table — simple cards otherwise.

Needs `evalBoardCondition` + wiring `def.condition` in **at resolution, not at the staging gate** —
see the condition-timing decision under Structural. NOTE: the commented stub sitting in the staging
loop (`emitter.ts`, "if board state does not meet activation condition / continue") is in the WRONG
PLACE and should be deleted rather than filled in. `BoardCondition` currently
cannot express either real example: `ZONE_SIZE` has **no comparison operator** ("8 or more" vs "5 or
less") and **no controller scoping** ("your hand"). Replace it with a compare leaf over two
`AmountExpression`s — `COUNT` already scopes via a `CONTROLLER` filter, making `ZONE_SIZE` strictly
weaker. No callers to migrate.

## 6. Give the engine a moment *before* a mutation

**Split into 6a and 6b (2026-08-07).** Capture and prevention were treated as one hook. They are
separable, and only capture is on the critical path — prevention is the hard design (replacement
priority, who intervenes, ordering), capture is mechanical.

### 6a. Snapshot capture — subjects move onto the signals — **COMPLETE, 2026-08-07**

**Why it is worth pulling ahead: it is net deletion.** It removes `signalSubjects` entirely, removes
the `anyListening` gate's reason to exist, removes `SubjectMatch.NONE`, removes the combat throw, and
removes the three deliberately-early emit orderings. Almost every open item below traces back to
subjects being *derived* from signals instead of *carried* by them.

Signals that name cards gain a `subjects` field; `SignalActivation` becomes discriminated on whether
that field exists. See "Subjects live on the signal" under settled decisions for the full shape.

**The mechanic: move the CAPTURE early, not the EMIT.** The three early-emit sites emit early because
that is currently the only way to see pre-mutation state. Once a subject carries a snapshot, the two
decouple — capture before the mutation, emit after it — and all three normalise to mutate-then-emit
with nothing lost.

**THE CAPTURE RULE — always pre-mutation, one rule** (settled 2026-08-07, superseding the entry/exit
split below):

> **A subject is the card as it was immediately before the cause took effect.**

Signals are past-tense and descriptive, so this is just what last-known information means, and it is
what this plan's own subject definition already says ("captured as of the instant the signal's cause
was determined"). The entry/exit rule contradicted that definition and is now deleted.

**Why there is no post-mutation case.** You never need a snapshot to read post-mutation state,
because the live board already *is* that state at emit time. Snapshots exist for exactly one reason —
to preserve what the mutation destroys — so a post-capture snapshot is a frozen copy of a board you
could still read. Surveyed against the real signal union:

- Pre-capture is load-bearing for `CARDS_SENT_TO_TRASH`/`_HAND` from the field (power with DON
  attached, rested, controller), `DAMAGE_TAKEN`/`LIFE_DAMAGED` (the life card before it moves to
  `trigger`), `BATTLE_RESOLVED` (defender power before the K.O.), and `CARD_REMOVED_FROM_FIELD` —
  which is **already lossy today**, since the DON detach runs before the emit.
- The cases that looked like they wanted post-capture do not. `CHARACTER_PLAYED` differs pre-vs-post
  in the zone alone, and every filter a real On-Play card uses (`TYPE`, `COLOR`, `COST`,
  `CONTROLLER`) is definition-derived and timing-invariant — with the origin already on the signal as
  `fromZone` and the destination implied by the signal type. `DON_ATTACHED` wants the target's
  post-buff power, which the live board has at emit. `CARDS_RESTED` carrying `rested: false` reads
  oddly against a past-tense name, but nothing queries it — the signal type already carries the fact.

**Not "head of the operation".** `cardsDraw` knows a count, not which instances, so there is no
subject set to snapshot until the deck has been read. Head-of-operation is where the *prevention*
hook goes (6b) — a different position, and fusing the two breaks the draw case.

**Corollary — `activeZone` is the zone the listener is in AT EMIT TIME, and the gate keeps reading the
LIVE zone.** Once every site is mutate-then-emit this is uniform with no special-casing anywhere:

| effect | card at emit time | `activeZone` |
|---|---|---|
| On-Play character | moved to `CHARACTERS`, then emit | `CHARACTERS` — unchanged |
| Event | moved to `TRASH`, then emit | `TRASH` — unchanged, already the documented convention |
| On-K.O. | moved to `TRASH`, then emit | `TRASH` — changes from `CHARACTERS` |

The On-K.O. row is the only change, and **nothing is authored against it yet** (`src/cards/` holds
`OP04-045` and `OP13-041`, both On-Play). It must still land in the *same change* as the emit
reordering, because the failure mode is silent staging.

Two alternatives were considered and rejected. **Reading the captured zone** breaks On-Play: under
pre-capture `zoneAtCapture` is `HAND`, which fails against `activeZone: CHARACTERS` and silently kills
the most common effect in the game. **Narrowing On-K.O. with `fromZone: [CHARACTERS]`** does not work
either, and the reason is worth recording: the activeZone gate runs *before* the activation is
consulted, so a card already in `TRASH` is filtered out no matter what the activation says — and
`CARD_REMOVED_FROM_FIELD` carries no `fromZone` field at all, so asking for one fails by the
does-not-carry rule. No `fromZone` narrowing is needed regardless: the signal only ever fires for
field departures, and `removalMethod` discriminates K.O. from bounce within it.

Sizing (measured 2026-08-07): 26 of 31 signal variants name cards; ~51 emit sites populate them;
`signal.instanceId(s)` is **read in exactly two places, both inside `signalSubjects`**. The ids are
write-only today, so this is a write-side migration with no read side to chase.

### 6b. Prevention / replacement / continuous "cannot be X" *(DEFERRED — not scheduled, 2026-08-07)*

**Why:** the remaining needs of the original milestone 6 — continuous protection, replacement
effects, and the veto half of the pre-operation hook. Still the biggest item and still not to be done
piecemeal. See the workstream section for the query-vs-signal sizing question, which applies to 6b
only; 6a needs no such decision because capture is a pure read.

**Explicitly off the table until the subject work lands.** Beyond its own size, cancellation has a
control-flow problem worth naming before anyone reopens it: a prevented operation has to unwind back
into whatever invoked it, and an effect that was mid-resolution when its operation was cancelled has
to resume somewhere coherent. That interacts with the cursor, the consumption boundary (invariant 3)
and `abort`-vs-`done`. Not a reason it cannot be done — a reason not to open it alongside 6a.

The head-of-operation hook position belongs to **this** milestone, not to capture. Keep them
separate: capture is pre-mutation at a point the operation chooses, prevention is at the operation's
head where it can still refuse.

## 7. Teach signals about roles

**Largely subsumed by 6a.** Roles become a field on the subject rather than an ambiguity in a flat
list, and the discriminated `SignalActivation` falls out structurally instead of being hand-cut.

**Why it remains a milestone:** the role *vocabulary* still has to be designed against real card
text. The signals needing it: `ATTACK_DECLARED` (attacker/defender), `ATTACK_REDIRECTED`
(attacker/from/to), `BLOCKER_DECLARED` (blocker/attacker/prevDefender), `COUNTER_PLAYED`,
`BATTLE_RESOLVED`, `DON_ATTACHED` (don + target), `DON_DETACHED` (don + origin).

**Narrowed, 2026-08-07 — and combat is the WEAKEST case for roles, not the strongest.** Step 1 shipped
`subjects: CardSnapshot[]` with **no role field and no `Subject` wrapper**, deliberately: the
multi-role signals are combat and DON, a disjoint set of emit sites from the movement and play signals
converted so far, so nothing converted gets re-touched when roles arrive. There is no churn to hedge
against.

Where roles actually earn their place, which is narrower than the list above:

- **`BLOCKER_DECLARED.prevDefenderId` and `ATTACK_REDIRECTED.fromDefenderId` are HISTORICAL** — no
  state field holds them once the redirect has happened, so nothing can read them back.
- **`DON_ATTACHED` (dons + target) and `DON_DETACHED` (dons + origin)** pair two different *kinds* of
  card. A flat list lets a filter written for the character match a DON instance.

Where they do NOT:

- **Battle roles are already split across two fields.** `resolveBattle` emits with
  `cause: { kind: "BATTLE", sourceId: attackerId }`, so `SignalActivation.source` filters the attacker
  and `subject` filters the defender, with no role tag needed.
- **Reading roles back off `state.currentBattle` does not work** — `removeCurrentBattle` runs before
  all three `BATTLE_RESOLVED` emits, so it is already `null` at emit and doubly gone by resolution.
  More fundamentally `CardFilter` is a per-card predicate with no cross-referencing leaf; adding one
  would couple the filter language to combat AND make it a live read.
- **The two big combat abilities are phase-shaped, not instance-shaped.** "When attacking" and "on
  opponent's attack" read more naturally as activations keyed to a battle phase than as subject
  filters over an attacker/defender pair. Battle is a continuous phase, so a combat-specific
  activation shape is the likelier answer than a general role vocabulary. **Design against real card
  text before committing either way.**

Two candidate shapes remain live for when this is picked up: a role tag on a flat list
(`{ snapshot, role }`), or named fields per signal (`DON_ATTACHED: { dons: CardSnapshot[]; target:
CardSnapshot }`) with the activation naming which field it filters. Named fields are structurally
typed rather than string-tagged, which fits how `SignalActivation` is meant to discriminate, but they
fragment the emitter's single "feed subjects to the filter" path.

Rule for what becomes a subject: **a card reference is a subject if the activation language should be
able to filter on it.** `cause.sourceId` is deliberately NOT one — it has its own `source` filter,
and keeping them separate is what lets an activation tell "caused by a player" from "caused by an
effect".

---

# Settled design decisions — do not re-litigate

## Signals are the activation language (2026-07-26)
- **Signals are legitimate vocabulary in the ACTIVATION layer.** A neutral "occurrence"/"event"
  abstraction was proposed and **REJECTED** — the engine owns both signals and definitions, so
  abstracting buys nothing and costs type safety.
- **`SignalActivation` is FLAT, not discriminated** — *superseded 2026-08-07, see "Subjects live on
  the signal". The escape clause fired: subject-carrying vs subject-less IS the second signal shape.*
  Original reasoning, still valid for why it was not built earlier: flat covered every signal shape
  in use, and the union only pays off when a second shape arrives. Shipped:
  ```ts
  { signal: SignalType; subject: CardFilter;
    causeKind?: SignalCause["kind"][]; source?: CardFilter; fromZone?: Zone[] }
  ```
  Optional narrowings, omitted = match anything. **Asking for a field the signal does not carry FAILS
  rather than matching** — a definition error must not fire on everything.
- **`causeKind` and `source` are TWO fields, not one predicate.** A `CausePredicate` wrapper was
  rejected as over-structured. Genuinely different checks: a `CardFilter` alone cannot tell "caused
  by a player" from "caused by an effect", because with no `sourceId` to test it simply fails,
  conflating no-cause with wrong-cause. Named `source` despite the conceptual collision with
  `EvalContext.source` ("the card whose effect is evaluating").
- **`cause` is MANDATORY on every signal.** `ATTACK_DECLARED`/`COUNTER_PLAYED`/`BATTLE_RESOLVED` had
  none; added at their emit sites in battle.ts. `BATTLE_RESOLVED` names the attacker as source, which
  makes "when a battle my character was in resolves" expressible through the normal `source` filter.
  Those three ops do not take a `signalCause` param, so values are hardcoded — an effect that forces
  an attack would need it threaded through.
- **STAGE-ONCE, never fan-out.** One event = one EffectRef = one resolution = one `oncePerTurn`
  consumption. Multiplicity lives in the DATA (`SUBJECT_COUNT`), never in the number of refs. Fan-out
  would make the consumption boundary and `oncePerTurn` incoherent.
- **Multiple effects on ONE card** watching the same signal stage independently and resolve
  sequentially — trust card designers not to make same-card effects order-dependent. Genuine clashes
  are between MULTIPLE CARDS; that is what the staging frame is for.
- **One effect with TWO matching activation entries → UNION of subject sets**, deduped, insertion
  order preserved (`flatMap` + `Set`). Decided by implementation.
- **Expressions stay pure board queries.** `CardFilter`/`BoardCondition`/`TargetExpression` are used
  outside activation (`StatusEffectDef.affects`, actionGen gating an `[Activate: Main]`), so they
  must not assume a signal.
- **Everything activates through emit, including invoked abilities.** actionGen gates a Main ability
  on `def.condition` to decide action legality; invoking emits a signal that stages normally.
- **Status effects sit outside activation entirely** — passive alterations read during calculation,
  cleaned up on expiry. They never stage.

## Subjects live on the signal (2026-08-07)

- **DEFINITION. A *subject* is a card the signal is about, captured as of the instant the signal's
  cause was determined.** It carries identity, computed state at capture, and an optional role. The
  vocabulary is kept (nothing better survives contact — "affected" is wrong for `ATTACK_DECLARED`,
  "participants" is worse), but the meaning is now LKI, not a live id. That definition does real
  work: it tells an author a subject filter reads the board *as it was*.
- **Signals CARRY their subjects; nothing derives them.** `signalSubjects` exists only because
  signals name cards under inconsistent field names (`instanceId`, `instanceIds`,
  `attackerId`/`defenderId`). Put the field on the signal and the translation layer has nothing to
  translate. **Replace `instanceIds`, never duplicate it** — two sources of truth drift, and the
  read side is already empty (two reads, both inside `signalSubjects` itself).
- **Migrate by category, not big bang.** A signal type either has `subjects` (converted) or its old
  id field (not yet), and `signalSubjects` shrinks into a shim handling only the unconverted. Its
  existing throw is already the migration tracker: it means "this signal type is not supported yet".
  Delete the shim when it is empty. Movement signals first — that is what the driving cards need.
- **GOVERNING INVARIANT: carried subjects ≡ the set that satisfied the filter.** Never the raw signal
  set. "Draw for each card discarded" and "draw for each RED card discarded" differ *only* in the
  filter; the payload follows the filter in both. Re-running a filter at resolution against a
  post-mutation board is the LKI trap itself.
- **Activation runs in TWO TIERS, in this order.** Tier 1 = signal-level (`signal`, `causeKind`,
  `fromZone`, `source`) — cheap predicates, touches no cards. Tier 2 = subject selection — the only
  tier that produces a value. Today the subject filter runs *first* (`emitter.ts:86`); reorder it.
- **RETURN CONTRACT, the crux.** `null` = did not activate · `[]` = activated, carries nothing ·
  non-empty = activated, carries these. One extracted function (`selectSubjects`) owns it.
  ```
  ANY_OF   → matches.length === 0 ? null : matches
  ALL_OF   → raw.length > 0 && all raw match ? raw : null
  ```
  `ALL_OF` must reject an empty set or it is vacuously true and fires on every subject-less signal.
  Its payload is always the full raw set, so it is a **pure gate refinement** — it buys nothing on
  the carrying side. Driving card: *"Destroy all your own characters. If they were all 1-cost, …"*
  (note it must filter on `COST`, not `POWER` — see the snapshot caveat below).
- **`SubjectMatch` is MANDATORY on every subject-carrying activation**, deliberately verbose. An
  optional field makes a forgotten filter silent, and the effect it breaks is On-Play — the most
  common in the game — by turning "when this is played" into "when *anyone* plays a character".
  Verbosity is not a cost in practice: real filters are `ANY_OF: opponent's characters`, not
  `ANY_OF: ANY`.
- **NO `NONE` MEMBER.** `signalSubjects` switches on nothing but `signal.type`, so subject-carrying
  is a *static property of the signal type* and `NONE` can never be false for a well-formed
  definition — a check that can only pass is not a check. Once signals carry subjects the partition
  is structural (`Extract<GameSignal, { subjects: … }>`), needs no hand-maintained list, and cannot
  drift. Phase-keyed activations then have no `subject` field at all, because the type says so.
- **Board-wide "all" is a `BoardCondition`, not a subject quantifier.** *"If you have 5 characters
  and all are {Navy}"* asks about the character area, which no signal named. Authoring it as
  `ALL_OF` quantifies over a one-element set and passes far too easily. Needs milestone 5's compare
  leaf: `COUNT(CHARACTERS, TYPE Navy) >= 5 AND COUNT(CHARACTERS, NOT(TYPE Navy)) == 0`.
- **`CardSnapshot` becomes the UNIVERSAL input to `evalCardFilter`.** Not a second evaluation mode —
  live evaluation is "a snapshot taken now", LKI is "a snapshot taken then", and the only difference
  is when it was captured. Otherwise `CardFilter` forks into live and frozen paths across its three
  users (activation subjects, `StatusEffectDef.affects`, actionGen gating), which is the split that
  rots. Caveat: definition-derived facts (colour, cost, name, type) survive a mutation anyway;
  mutable computed ones (power with DON, rested, prior zone) are the reason capture exists.
- **DON needs care in capture.** `getCardDef` throws for DON, and `DON_ADDED`/`DON_RESTED`/
  `DON_ATTACHED` all name DON instances. `getListenerInstanceIds` already filters DON before the
  lookup for this reason; snapshot capture must too.
- **Cost accepted: `gameLog` gets heavier**, since every signal now carries snapshots. Replay is seed
  + action log, so correctness is unaffected; this is memory only.

## Battle abandonment (2026-08-07)

**A GAME RULE, not a card interaction.** If a battling character leaves the field before the battle
resolves, the required behaviour is:

> The effect finishes resolving. Then the battle **fizzles** — no resolution — and play returns
> peacefully to MAIN.

"Fizzles" is literal: no `BATTLE_RESOLVED` is emitted, no damage is dealt, no K.O. consequence runs.
Anything keyed to battle resolution therefore does not fire, which is correct — the battle did not
resolve, it was abandoned.

**The ordering is already right by construction.** `step` runs `advanceEffect` and returns whenever
`currentEffect !== null` (conductor.ts), so the effect queue drains completely before the phase switch
is reached. Effects finish, *then* the battle is examined. Nothing needs adding for that half.

**Activation is committed** — an effect that staged while its card was on the field still resolves
after that card leaves, because the activeZone gate runs at STAGING time, not at resolution. This
covers the one case that is not self-terminating: both players stage into the same frame, the turn
player's effect resolves first and removes the defender, and the defender's own effect then resolves
against a card already in the trash. That is intended.

**The guard belongs at the head of battle-phase handling, not just before resolution**, because the
departure can land during any of `WHEN_ATTACKING`, `ON_OPPONENT_ATTACK`, `BLOCKER` or `COUNTER`. Test
is a zone check on both participants (`CHARACTERS`/`LEADER`); on failure `removeCurrentBattle` and
return to MAIN. Two existing holes assume both are still on the field:

- `conductor.ts` `BLOCKER` case — `getCardInstance(state, state.currentBattle!.defenderId)` returns a
  trashed card perfectly happily and asks its controller to declare a blocker.
- `resolveBattle` — its "current battle is corrupt" throw checks CLASS only, and a trashed character
  is still `class: "CHARACTER"`, so it would resolve and run `calculatePower` on a card in the trash.

**Reachable sooner than a K.O. operation.** `EffectOperation` has no K.O. today, but the driving shape
does not need one: *"[On Opponent's Attack] You may trash this Character. If you do, …"* removes the
defender through an optional `PaymentStep`. So this lands with payments, not with K.O.

**`BattleRecord` snapshots — deferred, mechanism understood.** Phase-keyed battle abilities read
`state.currentBattle` live at resolution, so an effect resolving after a participant has left reads
base stats (DON already detached). The fix is the same capture used everywhere else — put
`attacker: CardSnapshot` / `defender: CardSnapshot` on `BattleRecord` at declaration and read those
for anything computed, ids only for identity. NOT built: no card currently reads a battle
participant's computed stats in that window. Build it when one does.

## Targeting (2026-08-16)

- **Selection resolves a BINDING, not the effect.** Selection populates a slot; a later mutating step
  consumes it. Selection is **trigger-inert** — signals fire only on application, never during picking.
- **Targeting is an OPERATION, not a phase.** `Select` is the missing *producer* of the binding that
  Move/Orient/Modify/Grant consume. Both Payment and Resolution invoke the same machinery; what
  differs is the enclosing phase's failure contract, never the mechanism. **No "is this a cost?" flag
  on targeting** — the phase location already encodes it.
- **The load-bearing invariant: Requirement gates, Payment rewinds, Resolution absorbs.**
  ⚠️ **"Payment rewinds" was NARROWED on 2026-09-26 — see "Payment failure" below.** It cannot restore
  state, only abort the effect forward. Payment and
  Resolution share the whole operation vocabulary and differ only in what happens when a step cannot
  complete. Cost execution belongs in Payment; `PaymentStep.cost` already puts it there, and what was
  actually missing is `Select` — a *targeted* cost has nowhere to resolve its target under the abort
  contract.
- **Kill Requirement/Payment drift by deletion, not validation.** Derive the can-I-pay check from
  Payment's own `TargetExpression`, read in feasibility mode for the gate and selection mode for the
  pick. One filter, two invocation points. Do **not** build an equivalence validator — proving two
  filter expressions equivalent is a theorem-prover trap. Residual safety is a harness assertion.
- **One budgeted-selection primitive, never subset enumeration.** A running budget draws down per pick;
  re-derive the filter against what remains; auto-terminate when nothing fits. "Up to N" is the
  degenerate case where every pick weighs 1, so counts and sum-constraints are ONE primitive (DON
  attachment is the same primitive again).
- **`capacity` / `weight`, not `budget` / `unitCost`.** `capacity` replaces `max` rather than sitting
  beside it, so `min` and `capacity` are the floor and ceiling of one quantity. `unitCost` was rejected
  outright: the codebase already has three `cost`s (`CardDef.cost`, `calculateCost`, `EffectCost`).
  Note `min` is in capacity units, so mixed-unit constraints ("at least 2 picks, at most 4 cost") need
  a `limits: []` generalization that is **not** built.
- **`optional` is DERIVED from `min`, not stored.** `stopAllowed = accumulated >= min ||
  noCandidatesFit` — the `optional` term drops out entirely, because `min: 0` is already true at zero
  picks. This must NOT absorb `PaymentStep.optional`, which is the different question "may I skip this
  entirely" and stays a flag.
- **`min` and `capacity` are REQUIRED; `weight` and `chooser` optional.** The rule: required when the
  default is dangerous, optional when the default is the common and safe reading. A missing `min`
  silently turns "choose 2" into "up to 2"; a missing `weight` gives count semantics, which is the
  majority. Neither needs `null` — unbounded capacity is `COUNT` over the same zones/filter, which is
  exact and adds no state.
- **`chooser` is orthogonal to the filter.** It decides who answers; it must NOT change
  `EvalContext.self`. "You choose 2 of your opponent's Characters" and "your opponent chooses 2 of
  their own" share a filter and differ only in `chooser`. Flipping `self` would invert the second.
  Needs an opponent-derivation helper, which does not exist — filters only ever test inequality.
- **PROMPT IFF THERE IS AT LEAST ONE LEGAL PICK.** No legal picks → complete immediately with whatever
  accumulated. That single clause is the whole rule: fizzle-at-zero is it, and the "you picked 2 of 2,
  confirm?" prompt disappears without a special case because a full budget leaves no legal pick.
  **The zero case is FORCED, not chosen** — a decisionPoint no action can answer is a hard deadlock
  (`getLegalActions` filters through `validate` and returns `[]`; this is the `RESOLVE_EFFECT_ORDER`
  bug).
- ~~**Forced selections auto-resolve** (`candidates.length <= stillNeeded` → take all).~~
  **DROPPED 2026-11-07.** A harness collapses forced nodes *itself* — `getLegalActions` returning
  exactly one action is visible at the call site, so a searcher takes it without expanding and the
  engine gains nothing by doing it internally. Removing it also makes the `ChoiceStep` trap below
  **unreachable** rather than merely warned against, and it is a *deletion* from the prompt rule rather
  than an exception to it. Cost is one round trip per forced pick, and the pick now appears in the log
  as a real action, which makes the log self-contained and lets a test assert the player was asked.
- **`ChoiceStep` must NOT inherit that shortcut** — kept as the reason the shortcut is gone, not as a
  carve-out. "Take top or bottom of life" with one life card has a unique *card* but two
  distinguishable *labels*, and a later effect can read which was chosen. Outcomes must be unique in
  everything observable, not just in which cards moved.
- **Loop state lives on `EffectContext.selected`, NOT in `locals`.** `locals` is the program's
  variables (author-named, author-read); this is the interpreter's bookkeeping. Merging them is how the
  frame becomes a junk drawer. It stores **only the picked ids** — remaining capacity, min, weight,
  chooser and the bind name are all derivable from `steps[cursor]`, which is guaranteed to be the right
  step because the cursor does not advance while a selection is open. `null` vs `[]` is load-bearing:
  `null` = no selection running, `[]` = one running with nothing picked yet.
- **The pause rule: a step that set a `decisionPoint` has not completed.** Don't advance the cursor.
  Generalizes to `PAYMENT` for free, and keeps the stepper ignorant of selection specifics.
- **Feasibility-aware filtering makes "2 or none" emergent**, not a coded mode — offer a pick only if a
  legal completion is still reachable. Bounded yes/no search, never a materialized powerset. Stubbed
  as always-true, which is correct for every cap-type constraint. **The stub has an expiry condition:**
  the moment a "cannot be K.O.'d" card is authored it starts offering unpayable costs, because
  feasibility for a *cost* must ask "would this removal actually go through", not just "does a legal
  completion exist".
- **Two kinds of protection, only one is a filter concern.** "Cannot be *chosen*" is a targeting
  restriction and lives in the filter. "Cannot be *K.O.'d*" is a replacement — the card is offered,
  selected and bound, and the removal is cancelled at application. Do not conflate them.
- **Replacement application is TWO-PHASE and order-independent.** ⚠️ **The "eliminate / survivors"
  phrasing below is the EXCLUSION-ONLY SPECIAL CASE — see "Replacement is a rewriting system" (2026-09-27)
  for the general form.** The phase structure and the order-independence argument both survive intact;
  what changes is that phase 3 applies a *plan*, not a filtered set. A replacement applies only if its
  source is not itself in the removal set. Phase 1 resolve the binding; phase 2 eliminate replacements
  whose sources are in it; phase 3 apply to the survivors. A naive sequential loop makes the outcome
  depend on processing order — a protector processed late fires from beyond the grave. Costs for
  surviving replacements are offered in phase 2, never before, so a doomed protector is not asked to
  pay. **Consequence: consuming operations must take the WHOLE binding**, never iterate one card at a
  time — a per-card loop cannot express phase 2 at all. ~~Open hole: mutual protection is a fixed
  point needing a tiebreak.~~ **CLOSED 2026-09-26** — evaluating eliminations against the frozen
  phase-1 set makes it total; see "Payment failure" below.
- **Canonical ordering** (each pick's id exceeds the prior) collapses permutation redundancy to one
  path per subset. Sound *because* selection order never reaches application — phase 1 produces a set.
  Note there is no Zobrist/transposition table in the engine today; the stated payoff is forward-looking.
- **SEQUENTIAL over BATCH — reconfirmed 2026-11-07, and the batch alternative is named here so it is
  not re-proposed by accident.** A batch action (`CHOOSE_TARGETS { instanceIds[] }`, which is still the
  declared shape in `types/action.ts` and must be reshaped to singular) validates fine — a set check on
  `min <= Σweight <= capacity` plus zone/filter membership, with **no feasibility lookahead needed**
  since nothing partial is ever committed. It dies in `actionGen`: generate-then-filter-through-validate
  means every candidate action is a whole subset, so "up to 3 of 8" is 93 actions and a weighted
  selection on a wide board is unbounded. The only fix is to make `EFFECT_TARGET` a **constructive**
  decision point — `genChooseTargets` enumerates nothing, `constraint` carries the full rule set, and
  callers *construct* a legal action instead of choosing from a list. Price: **`getLegalActions` stops
  being total**, and the generate-then-validate invariant (the thing that caught the `SUBMIT_REORDER`
  gap) breaks for that one DP. The real trade is **stepper complexity vs. action-space enumerability**;
  enumerability wins because deterministic replay and self-play both want one uniform "here are your
  legal actions" with no per-DP special knowledge. Batch genuinely buys a trivial stepper (no pause
  rule, no re-entrancy, no `selected` state machine) and easier dual-constraint validation — so if
  rung 3's stepper work turns out worse than it looks, **constructive decision points are the
  alternative to reach for, not a batch action bolted onto an enumerable DP.**
- **Client batching is UX staging over incremental engine actions.** The client keeps a provisional
  pick list, projects visuals from `(true state, picks)`, and on commit dispatches picks **one at a
  time** exactly as a self-play harness would. The engine's vocabulary has no batch action. Derived
  values refold from the list, so deselect needs no unwinding — the engine's `selected` matches that
  shape deliberately, or the two halves would disagree about what is authoritative.

## Payment failure, replacement, and outcome reporting (2026-09-26)

Derived from one worked example: *"Trash 1 card from hand and place 1 cost 1-2 Character at the bottom
of the deck: this card gains +3000 power"* against *"Trash 2 cards from hand: prevent this Character
from being removed from the board."*

- **"Payment rewinds" is NARROWED to "Payment aborts FORWARD; already-applied sub-payments stand."**
  The original phrasing promises something the engine cannot deliver. Two independent reasons:
  1. **Rewind is unimplementable once a sub-payment has emitted.** Trashing a card emits
     `CARDS_SENT_TO_TRASH`, which can stage further effects. You cannot unring that without
     transactional emit, which the engine does not have and should not get.
  2. **Catching it earlier is UNDECIDABLE.** The obvious escape — make the Requirement gate
     replacement-aware so an unpayable cost is never offered — requires knowing whether the *opponent*
     will choose to pay an **optional** protection cost. That is a future decision by another player.
     No gate can predict it, which is also why the feasibility stub cannot simply be widened.
  So there are **three failure modes, and only one ever wanted a rewind**: *declined* (optional, nothing
  applied), *structurally impossible* (gated by Requirement, never reached), and *applied but
  neutralized by a replacement* — the new one, where partial state change stands and the effect aborts.
  Consistent with the event ruling: playing into a cost you cannot complete is legal and binding.
  **Refined 2026-11-08 — see "Payments are all-or-nothing, and an unpayable one is a bug" below:**
  mode two, if it IS reached, throws.
- **A payment step completes because it WORKED, not because it RAN.** This is the defect the example
  exposes: selection and application both happen inside the payment step, so by the time a replacement
  reduces the applied set the step has already been recorded complete. Completion must be a verified
  postcondition.
- **Operations must REPORT WHAT THEY APPLIED**, not just return `GameState`. The bare-state return is
  what makes a replacement's reduction invisible to the caller. **One channel, three consumers:**
  payment verification, `PriorActionResolved` (*"K.O. 1 Character. If you do, draw 1"* — 28 cards), and
  replacement-aware feasibility. Build it once. This is also the value `bind` writes into `locals`,
  which is why binding belongs to the stepper rather than to the operation.
- **The stepper gains a THIRD outcome: FAIL.** `completed` → advance the cursor; `paused` → hold it;
  `failed` → clear `currentEffect` and log the reason. On failure the cursor never reaches the
  `ResolutionStep`, so **resolution needs no payment checks whatsoever** — which is what keeps
  "Resolution absorbs" true. Do NOT fix this by teaching resolution to verify payment.
- **`paused` has TWO disjuncts, and missing the second is a silent bug.** Hold the cursor if a
  decisionPoint was set **OR the effect stack grew**. A pushed replacement context sets no
  decisionPoint — its first step may be a `REQUIREMENT` that auto-resolves — so a check keyed only on
  `state.decisionPoint !== null` advances past the original operation, the replacement runs, and the
  original never applies. It looks like "the protection cancelled everything".
- **A replacement runs as its own `EffectContext`, so `currentEffect` must be suspendable.** Reuse the
  ordering machinery rather than inventing a stack vocabulary: suspend the original onto
  `suspendedEffects`, stage the applicable replacements as a normal frame, let `commitEffectFrame` +
  the existing `effectQueue` logic promote them (so `RESOLVE_EFFECT_ORDER` gives the controller their
  ordering choice **for free**), and pop the suspended effect when the queue drains. One insertion in
  `step`, after the `effectQueue` block and before the phase switch.
- **`selected` needs a THIRD position.** `CardInstanceId[] | null` cannot distinguish *collecting* from
  *collected-and-frozen, replacements resolving*. On resume from a replacement a non-null `selected`
  with budget remaining looks like an open selection and the operation reopens collection. Shape:
  `{ picks: CardInstanceId[]; phase: "COLLECTING" | "CONFIRMED" } | null`. Still interpreter
  bookkeeping, so still not in `locals`.
- **Replacement DISCOVERY is a scan; only its EXECUTION is a context.** Discovery cannot be
  signal-activated: every activation path is post-hoc and past-tense, so an interrogative "about to be
  K.O.'d, anyone?" signal would need a non-committing emit path and a log that separates intents from
  events. Instead scan the board for replacements whose filter matches a member of the frozen set, then
  stage a context to run their steps.
  ⚠️ **This bullet previously said the scan should live on the status subsystem (`PROJECTION` /
  `affects`) and that the replacement's answer is a protection MARK. Both were wrong — see
  "ONE mechanism, not two" (2026-11-07).** The scan is its own hook; the answer is written into the
  pending-operation record's `plan`.
- **Application must TOLERATE STALE IDS.** Nested resolution can move a card that is in the frozen set:
  a replacement's own operation emits, which can stage further effects, which resolve before the
  original resumes. `selected` holds ids rather than snapshots (correctly — application must hit the
  live card), so every consuming operation needs a validity re-check at apply time and must skip
  members that have left the zone. A requirement on all of them, not a special case.
- **Player-chosen replacement order must NOT feed back into elimination.** Ordering is prompt-and-cost
  sequencing among the *survivors* of phase 2 and nothing more. If it could change which cards survive,
  order-independence is gone and with it the justification for canonical ordering. The frame/queue
  approach above enforces this structurally, since the frame is built after phase 2 has run.
- **Mutual protection is CLOSED, not open.** Evaluate every elimination against the frozen phase-1 set,
  simultaneously, and A-protects-B / B-protects-A yields *both replacements eliminated, both cards
  removed* — which is exactly the already-settled single-protector rule ("if the protector is itself in
  the removal set and does not protect itself, removal wins"). The fixed point only appears if you
  evaluate sequentially against a mutating set, which the two-phase rule forbids. Nothing left to
  tiebreak.
- **`DecisionPoint` is a DERIVED PROJECTION — `actionGen` must not re-derive candidates.** Restating
  invariant 2 because it is easy to get backwards: the resolved `TargetExpression` is materialized into
  the decisionPoint at pause time, and `validate`/`actionGen` read ONLY the decisionPoint. Direction is
  step→decisionPoint. Having `genChooseTargets` re-run the evaluator would be a second independent
  authoring of legality. This is what `constraint: null` is a placeholder for.

## Payments are all-or-nothing, and an unpayable one is a bug (2026-11-08)

- **A cost is paid in full or not at all — partial payment is ILLEGAL.** The only decline point is the
  `PaymentStep.optional` prompt, asked once, BEFORE selection opens. Accepting commits the player to
  the whole cost; nothing mid-selection lets them back out. The engine already enforces this —
  `stopAllowed = accumulated >= min`, so no stop action is offered below the floor — but it is now a
  stated rule rather than a side effect of the formula. **Retracts** an earlier claim that a player could
  stop a cost below `min` and simply have the payment fail: that is not a legal move.
- **Multi-part costs are owed in full.** Accept *"trash 1 card and rest 1 Character"* and you owe both.
  PAY-3 (no `optional` after the first part) is therefore a RULE, not a convenience — declining part
  two is illegal, not merely wasteful.
- **Reaching a payment that cannot be paid is a DEFINITION ERROR, and the engine THROWS.** Same house
  style as `selectSubjects` (card listens for a subject-less signal), `SUBJECT_COUNT` (no signal in
  scope), and every unbuilt operation (*"an operation that silently does nothing is indistinguishable
  from an effect that resolved correctly"*). Throwing is unusually safe here: the reducer is pure, so a
  throw anywhere in an action **discards the whole action** — nothing half-applied, even mid multi-part
  cost — and deterministic replay makes the report a perfect repro (seed + action log).
- **How it throws:**
  - **At payment ENTRY, before the first pick** — so the message reads "payment on <card> effect <id>
    is infeasible" rather than failing deep inside an operation. The rollback makes a later throw safe
    too; entry is for the diagnosis.
  - **NOT `InvalidActionError`.** That means *the player did something illegal*, and a client will show
    it as a rejected move. This is a broken card. Add a distinct `DefinitionError` to `errors.ts` so the
    client and tests can tell the two apart.
  - **Name the card and effect in the message.** The throw surfaces on whichever action *reached* the
    payment, which may be the OPPONENT'S — their attack declaration can fail because of your
    "on opponent's attack" effect — so the error must point at the definition, not the action.
- **Combined, a SHORT payment is always a bug.** With a correct gate and no early stop, a payment
  selection can only close at its floor. So in a payment, closing on `noCandidatesFit` with
  `accumulated < min` means a gate lied → `DefinitionError`.
- **"Airtight" should be BY CONSTRUCTION, not by discipline.** Derive the gate from the payment's own
  `TargetExpression` (one predicate, two invocation points — see "Kill Requirement/Payment drift by
  deletion"). Then an author cannot write a payment its gate fails to cover, and the throw becomes an
  ENGINE assertion that only fires if the derivation itself is wrong. The static validator covers the
  rest before runtime: PAY-1, PAY-3, PAY-4.
- **Consequence for sequencing: weighted and overlapping-filter costs need per-pick feasibility BEFORE
  they ship.** Feasibility is still stubbed always-true. A count-only cost cannot strand, but a weighted
  or overlapping cost can — the player takes a card that leaves the rest unpayable — and under this
  ruling that throws. Loud and reproducible is the right failure, but it means those cost shapes are
  blocked on feasibility, not merely improved by it.
- **Resolution is unaffected — it still ABSORBS.** *"K.O. 2 of your opponent's Characters"* with one on
  the board K.O.s that one; do as much as you can. Gating a resolution on its floor would be a rules
  bug, fizzling the part that is possible. The throw is PAYMENT-ONLY.
- **Interception is not partial payment.** This rule governs the player's CHOICE. If the player pays in
  full and a replacement then prevents or redirects part of it, the 2026-09-27 ruling stands: the
  demanded operation did not happen, so the cost is unpaid and the effect fails forward.

## Replacement is a rewriting system, not a filter (2026-09-27)

Supersedes the exclusion-only framing in the Targeting section. The trigger for the change: *"if it
would go to hand, put it on the bottom of the deck instead."* The card still participates — only the
operation changed — so **no amount of set subtraction can express it.**

- **Four kinds, and only the first is set subtraction.** *Prevention* ("cannot be K.O.'d") drops the
  operation for a card; *destination substitution* (hand → deck bottom) and *operation substitution*
  (K.O. → return to hand) keep the card and change the verb; *amount substitution* (damage reduction)
  keeps both and changes a number. Exclusion being the common case is what misleads — build for the
  general form.
- **The output of the replacement pass is a PLAN: a partition of the binding into `(operation, cards)`
  groups.** Un-intercepted cards keep the original operation, prevented cards land in an empty group,
  redirected cards land in a group carrying a different one. Mixed boards and "all prevented" both fall
  out with no special case. Phase 3 applies the plan; the two-phase structure and the order-independence
  argument are unchanged.
- **The plan lives in a PURPOSE-BUILT pending-operation record on `state`, never in the interrupted
  effect's frame.** Shape: `{ operation, binding, plan, objections, consulted }`. A replacement's
  resolution writes its substitution *there*. **Rejected: letting a replacement rewrite another effect's
  `selected.picks`.** That is one effect's resolution reaching into a different, suspended effect's
  interpreter frame — untestable, unloggable, and unanswerable about who may write `selected` once
  `currentEffect` is a stack. It also makes the field mean "what the player chose" during collection and
  "what survived" during application, which is the field-meaning drift that the computed/base filter
  split exists to avoid. The record is an intent queue: explicit, inspectable, and the replacement never
  learns that a suspended effect exists.
- **That record SUBSUMES both attempt-memory sites.** `consulted` replaces both `selected.phase`'s third
  position and a `replacementsConsulted` flag on `currentBattle`. One structure, two origins, and each
  origin resumes itself by never having advanced — the cursor held, or the phase machine re-entering
  `BATTLE_RESOLUTION`.
- **The plan is DURABLE state; the operation outcome is TRANSIENT.** The plan must survive the
  suspension. What the retry applied must not — it is consumed by the stepper in the same tick, and
  persisting it creates a second record of the attempt that can disagree with the first. The one
  exception is opt-in: a step declaring `bind` copies `applied` into `locals`.
- **A REDIRECTED cost is NOT PAID** (ruled 2026-09-27). If a K.O. cost is replaced by a bounce, or a
  trash by a deck-bottom, the demanded operation did not happen. Therefore `applied` means *"cards to
  which the DEMANDED operation was applied"*, never "cards something happened to" — and the
  `applied >= min` comparison still needs no branch on why the set shrank. Declined, prevented and
  redirected are one check.
- **Do NOT build any of this yet.** It is the shape to leave room for. The room costs exactly two things
  at rung 2, both independently justified: operations return `{ state, outcome }` rather than bare
  `GameState` (justified by `PriorActionResolved` and `bind` alone), and `selected` holds the resolved
  binding for **all** target kinds rather than only `PLAYER_CHOICE_TARGET` (a selector-based cost is then
  verifiable by the identical comparison, with no new field).

## Replacement: ONE mechanism, not two (2026-11-07)

Corrects a wrong turn taken the same day. The proposal was to split protection by whether it carries a
cost — continuous protection as a **status** the removal operation reads, reactive protection as a
replacement. **Rejected.**

- **EVERY protection is a replacement. The cost-free case is the DEGENERATE one — a replacement with no
  `PaymentStep`.** *"Cannot be K.O.'d in battle"* and *"cannot be K.O.'d in battle if you discard a
  card"* are the same effect with and without a cost. Splitting them by cost means a card that later
  adds a cost to a previously-free shape has to **migrate across mechanisms**, and it is the same
  violation this plan rejects everywhere else: one mechanism whose degenerate case falls out, never two
  split by a property (cf. one budgeted primitive with "up to N" as weight-1, `optional` derived from
  `min`, `EffectCost` collapsing into `EffectOperation`, fizzle as the corner of prompt-iff-one-pick).
- **Uniformity costs NO extra reducer calls, which is what makes it affordable.** A cost-free
  replacement sets no decisionPoint, so `advance` — which already runs to a fixed point — completes the
  whole propose → stage → resolve → pop → retry → apply cycle inside **one loop**. The player never
  sees a pause; the log shows the replacement resolving. Both cases exercise the identical path; the
  free one simply never stops to ask.
- **The channel is the pending-operation record's `plan`, NOT a protection mark.** A status mark cannot
  express *redirect* at all (the card stays in the set and the verb changes), and it has nothing to
  attach to on the battle path, where there is no `selected` to subtract from — the record's `origin`
  handles that. The record was already the right answer on 2026-09-27; the mark was a regression.
- **Statuses keep DURATIONS and WINDOWS, never the intervention.** *"Your Characters cannot be K.O.'d
  this turn"* is a replacement that is **available** this turn, and the status expresses the
  availability. A printed continuous protection needs nothing extra — the `activeZone` gate already
  means "while I am on the field."
- **RESTRICTIONS remain a separate site, and that split is correct.** *"Cannot activate Main"*, *"cannot
  attack"*, *"cannot block"*, *"cannot be chosen"* are statuses read at **generation and validation**.
  The test: **is there an action to withhold?** A voluntary action can be denied, so it is gated; an
  involuntary event has no action to deny, so it must be intercepted. This is the same ruling as
  "cannot be *chosen*" living in the filter while "cannot be *K.O.'d*" is a replacement, lifted one
  level to actions — and it is why `genDeclareBlocker`, the Rush branch in `validate`, and the DON
  attach stub are all status work, not replacement work.
- **Corollary on suppression.** *"On-Play effects do not activate"* intercepts `emit`'s staging decision
  rather than an operation — a synchronous veto before `stageEffect`, no suspension. But if the card
  reads "this turn" or "while this is in play" it is a **duration**, so the cost was paid when the
  suppressor resolved and the suppression is continuous state `emit` reads. It is a replacement only if
  decided reactively at the moment of staging, with its own cost. Corpus-check before building: it
  decides whether this is a second interception site at all.

## Invocation goes through `emit` like everything else (2026-11-07)

Reverses a same-day proposal to have `applyActivateEffect` call `stageEffect` directly. The rejected
argument was performance — `emit` scanning the board for a fact the action already handed it. That scan
is at most 14 field cards and is negligible; it was not worth a second entry path into staging.

- **The real problem was never cost: SIGNAL MATCHING IS CARD-SCOPED, INVOCATION IS EFFECT-SCOPED.** A
  signal's subject is a *card*, so a card with two `[Activate: Main]` abilities has both matching a
  `THIS` subject filter, and invoking A stages **both A and B**.
- **Solved with `SignalPredicates.invoked?: "SELF"`.** The invoked effect declares
  `{ signal: "EFFECT_INVOKED", invoked: "SELF" }`; `matchesActivation` requires
  `signal.instanceId === instanceId && signal.effectId === effectId`. **Both halves are already in
  scope** at the matching site — `emit`'s inner loop iterates `(instanceId, effectId)` pairs
  ([emitter.ts:47-48](src/game/emitter.ts)) — so this needs NO `effectId` denormalized onto
  `EffectDef`, which was the earlier blocker and was simply wrong.
- **One signal serves both consumers.** The invoked effect sets `invoked: "SELF"`; an observer ("when
  your opponent activates an effect, draw 1") omits it and filters on controller instead. No second
  signal, no second staging path.
- **The omission hazard is handled by the VALIDATOR, not by avoiding the predicate.** Forgetting
  `invoked: "SELF"` would stage the effect on every invocation by anyone — the same silent overreach
  that made `subject` mandatory. It is statically decidable, so it is **ACT-5** in
  `EFFECT_INVARIANTS.md`: an activation listing `EFFECT_INVOKED` must specify `invoked`. That turns the
  silent failure into a build error, which is what makes the uniform path safe.
- **Consistent with the rule applied everywhere else in this plan:** one mechanism whose degenerate
  case falls out, never two paths split by a property. Here the property was "did the player initiate
  it", and splitting on it bought one saved line.
- **Two things the uniform path gets for free.** The `activeZone` gate applies, so "the card must be on
  the field" needs no separate check in `validate`. And *"why did this effect activate"* has exactly one
  answer — a signal matched.
- **`EFFECT_INVOKED` DOES NOT EXIST YET.** There is no such member in `GameSignal`; CLAUDE.md's "rename
  `EFFECT_ACTIVATED`" note refers to a signal that was never added. It must carry `instanceId` +
  `effectId`, making it the first signal that names an *effect* rather than cards (not unprecedented —
  `BATTLE_RESOLVED` carries a `BattleRecord`).
- **`subjects: []` for an invoked ability.** It activated on nothing; the player pushed a button. `THIS`
  still works in the body because it resolves through `evalContext.source`, not through `subjects`. The
  legal "activated, carries nothing" middle case.
- **The irreducible work is the OFFERING, and it is unchanged by any of the above.**
  `genActivateEffect` is an empty function, and filling it means deciding which invokes are legal
  **before any action exists** — `def.condition` and `oncePerTurn` read *predictively*. Nothing else in
  the engine does that (`PLAY_CARD` is deliberately generated without checking the effect's condition,
  and must stay that way), so the condition has two consumers at two different moments and must be ONE
  shared predicate. Phase restriction lands there too: `SignalPredicates.phase` means the phase being
  *entered*, so it cannot express "only during Main".

## Structural
- **`EffectCost` becomes a SUBSET of `EffectOperation`; `PaymentStep` holds a `CostOperation`.**
  *(Amended 2026-11-07: originally written as a flat merge. Costs are a PROPER subset — `LOOK`,
  `REORDER`, `DRAW` and `ADD_TO_HAND` can never be paid — so the restriction is kept with
  `Extract<EffectOperation, { type: typeof COST_TYPES[number] }>`, guarded by `as const satisfies
  readonly EffectOperation["type"][]` so a mistyped member errors instead of silently dropping out.
  Note for a SHARED verb, cost-vs-effect is not a property of the member but of the `target`: resting
  your own Character is a cost, resting your opponent's is an effect — which is the existing rule that
  operations never name a player.)* Payment and
  Resolution share the whole operation vocabulary and differ only in the failure contract, so two
  unions is two authorings of the same verbs. The drift is imminent, not hypothetical: `EffectCost`
  already has `REST` / `TRASH` / `RETURN_TO_HAND` with `target?: TargetExpression`, and rung 2 is about
  to add `REST` / `KO` / `TRASH` with `target?: TargetExpression` to `EffectOperation`. The tell that
  they were authored at different times is that `EffectCost` discriminates on `kind` and
  `EffectOperation` on `type`. Kill one by deletion — the phase location already encodes "is this a
  cost?", which is the same reason there is no cost flag on targeting.
- **Operations never name a player.** No `EffectOperation`/`EffectCost` carries a PlayerId. Who acts
  derives from expressions: `EvalContext.self` = controller of the activating card. `DRAW` draws for
  `self`; an opponent-acting effect says so through its filters.
- **`condition` stays on BOTH EffectDef and EffectContext** — the gate for whether the effect can be
  activated/paid at all, in place of an initial requirement step. Mid-resolution conditionals are
  RequirementSteps. (`cost` is the one removed from both — payment steps own it.)
- **`condition` is evaluated at RESOLUTION, against the live board, and failing FIZZLES** (settled
  2026-08-07). Not "never staged". The effect stages, promotes, finds its condition false and
  resolves to nothing — which is what makes the failure loggable, and what matches the physical game:
  you have already committed the card. Consumption is unaffected, since invariant 3 puts the
  boundary at the cursor entering the first ResolutionStep, which a fizzle never reaches.
  actionGen's separate read of `condition` — gating whether to *offer* an `[Activate: Main]` invoke —
  is the same predicate at a different moment, and applies to invokes only, never to `PLAY_CARD`.
- **Split the two conditions:** authored GATING requirements (board state) vs DERIVED affordability
  (computed from cost, never hand-written — kills the double-count trap).
- **`bind` (write) / `REF` (read).** `bind?: string` on the step base; REF is an EXPRESSION leaf, not
  a step field, added to TargetExpression/CardFilter/AmountExpression. Phase-1 REF =
  identity/set/count. NOTE: REF is for STEP-PRODUCED data. The activation's subjects are a different
  channel — always present, no path analysis needed.
- **`done` vs `abort` distinct terminals.** `abort` = pre-commitment, does NOT consume the use;
  `done` = success, consumes it. End-of-branch is `done`. `abort` illegal after the first
  ResolutionStep.
- **EffectCost atomic.** Single-part per PaymentStep; multi-line cost = sequential MANDATORY payment
  steps in card order. No `ALL` combinator.
- **Effect analyzer** = path-aware def-use over the jump graph: every REF defined on all paths before
  use, `EffectValue.kind` matches its host, every payment requirement-covered, multi-part payments
  non-optional after the first. Becomes load-bearing once effects move from TS to data.
  **The full rule set lives in `EFFECT_INVARIANTS.md`** — every invariant with its failure mode, whether
  it is statically decidable, and what it is blocked on. Add new authoring rules there, not here.
- **CardSnapshot** = identity (instanceId, cardId) + mutable computed fields only
  (power/cost/counter/keywords/controller/attachedDon/rested/flipped/zoneAtCapture). Def data
  recoverable via cardId. Live-vs-frozen read EXPLICIT via `EffectValue` kind (CARDS = live,
  SNAPSHOTS = frozen).
- **Terminology: "activate" → "invoke".** "activation" is RESERVED for the generic concept (an effect
  staging off any signal), baked into `SignalActivation`. The manual player-initiated Main ability
  must not reuse it: rename `EFFECT_ACTIVATED`→`EFFECT_INVOKED`, `ACTIVATE_EFFECT`→`INVOKE_EFFECT`.
  Never "trigger" (reserved — see the naming conventions in CLAUDE.md).

## Invariants with the highest retrofit cost
1. **Typed locals = the only cross-step data channel.** `locals: Record<string, EffectValue>`,
   `EffectValue = CARDS | SNAPSHOTS | NUMBER | BOOL`. Define the union before REF consumes it; `any`
   locals is the trap.
2. **DecisionPoint = derived projection, single source of legality.** Built once at pause time from
   the resolved TargetExpression; `validate`/`actionGen` read ONLY the decisionPoint. Direction is
   step→decisionPoint, never two independent authorings. This is where `CHOOSE_TARGETS` gets defined.
3. **Consumption boundary = cursor entering the first ResolutionStep.** One point = use marked in
   `effectsUsedThisTurn`, `abort` no longer legal, past-here-can't-rewind. Depends on all gating
   conditions sitting before any cost — satisfied by putting the gate in `def.condition`.
4. **Control flow = flat step list + `goto`/labels + `done`/`abort` terminals** — NOT nested groups,
   so `cursor` stays a single int and resume stays trivial.
5. **Test discipline (from Phase 1, keep it).** Stepper tests assert progress/order through OPERATION
   RESULTS (cards moved), not the cursor; exactly one test reads `cursor`, labelled as pinning
   invariant 4. Throws asserted bare, no message matching. The deferred goto/terminal work rewrites
   cursor semantics — brittle tests would all break.

---

# Deferred workstream — the pre-operation stage (milestone 6b, do NOT do piecemeal)

One function at the head of EVERY operation covering replacement/prevention hooks and continuous
"cannot be X" checks. **Snapshot capture split out into 6a** and is no longer deferred — it is a pure
read, needs none of the design below, and unblocks the subject channel on its own.

**The sizing question, still open: is it a synchronous QUERY or a SIGNAL?** A query (pure read of
`statusEffects`, shaped like `calculatePower`) covers snapshot capture + veto, keeps operations
atomic, and is cheap. A signal routed through staging/queue lets an effect resolve mid-operation,
forcing every operation to become resumable — very expensive. OPTCG protection looks overwhelmingly
continuous, so the query probably suffices. **Verify against real card text before committing.**

**Snapshots vs subjects were separated, and have been RE-COUPLED (2026-08-07 — reversal).** The
earlier call was that the matched-subject set is plain ids needing no capture-before-mutate. That
holds in isolation but loses on the whole: keeping them separate means building a subject channel of
ids, then rebuilding every consumer of it when snapshots land — and paying for `signalSubjects`,
`SubjectMatch.NONE`, the combat throw and the three early emits in the meantime, all of which
subjects-on-signals deletes outright. Re-coupled as milestone 6a; see "Subjects live on the signal".

What survives from the original call: **store the FILTERED match, never the raw signal id array.**
Re-running the filter at resolution evaluates it against a post-mutation board, which is the LKI trap
itself. That is now the governing invariant.

**Three pre-mutation emits are an early, informal stab at this same need** (audited 2026-07-25). The
convention is otherwise uniformly mutate-then-emit; exactly three sites emit early, and they are
exactly the three that will need snapshots. **Do NOT normalize them on their own** — fix the ordering
when 6a lands, so the information they reach for early has a real home. Once a subject carries a
snapshot taken before the mutation, emit ordering stops mattering and all three normalise to
mutate-then-emit.
- `_removeCardFromField` (cards.ts) — `CARD_REMOVED_FROM_FIELD` before `moveCard`, AND after the DON
  detach, so it is already lossy for computed power.
- `takeDamage` (life.ts) — `DAMAGE_TAKEN`/`LIFE_DAMAGED` before `sendTopLifeToTrigger` moves the card.
- `resolveBattle` (battle.ts) — `BATTLE_RESOLVED` after `removeCurrentBattle` but before the
  damage/KO consequence. A third convention again.

**What pre-emit buys, and does not:** it helps the STAGING GATE (emit evaluates the subject filter
synchronously, card still on the field) but does NOTHING for resolution — staging only pushes a ref;
promotion/resolution run later, after every mutation.

**On-exit activeZone is coupled to this.** NOT currently broken: `CARD_REMOVED_FROM_FIELD` fires
pre-mutation so the card is still in CHARACTERS and a naive `currentZone === activeZone` check passes
for On-K.O. today. Once that emit moves after `moveCard`, every On-K.O. effect stops staging
**silently**. ~~So `signal.fromZone` matching must land in the SAME change as the reordering.~~
~~**Superseded 2026-08-07:** the captured-zone rule in 6a handles both directions uniformly.~~
**Superseded again, 2026-08-07 (final):** the captured-zone rule is rejected — it breaks On-Play. The
rule is `activeZone` = the zone at emit time, so On-K.O. effects are authored `TRASH`. See the
corollary under 6a. The *silence* of the failure is unchanged, so that re-authoring must land in the
same change as the reordering; nothing is authored against On-K.O. yet, so today that is a docs-and-
convention change rather than a migration.

**While in there:** `declareBlocker` and `redirectAttack` (battle.ts) mutate BEFORE validating — not
a live bug (the throw discards state) but the same shape, and a pre-op stage would absorb those
checks. Minor: `playEvent` emits `CARDS_SENT_TO_TRASH` before `EVENT_PLAYED`, causally backwards.

**DANGER on that last one (2026-08-07).** Swapping the two emits is safe. Hoisting `EVENT_PLAYED`
above the `moveCard` is NOT — the card being in the trash before `EVENT_PLAYED` fires is a game-rules
requirement, and silently breaks *"if you have 15 or more cards in your trash"* (playable at 14) and
*"if you have 6 or more cards in your hand"* (playable at 7). Pin it with a test before touching
`playEvent`. See the event-card section in CLAUDE.md.

---

# Open questions
- **Does paying a COST count as "by an effect"?** (`[Activate: Main] You may trash 1 card from your
  hand: ...`) Extremely common in OPTCG; the engine cannot currently distinguish a cost payment from
  an effect operation. **Settle BEFORE `EffectCost` execution is written.** The `EffectCost` →
  `EffectOperation` collapse sharpens this rather than answering it: once the verbs are one union, the
  operation itself can no longer carry the distinction, so the `SignalCause` has to be stamped by the
  stepper from the step kind it is executing. That is the likely answer, but it is not settled.
- ~~**Phase-keyed effects cannot activate**~~ — **SETTLED 2026-08-07.** Answer: milestone 6a. Once
  signals carry their subjects, `SignalActivation` discriminates structurally and a phase-keyed
  activation simply has no `subject` field. All three options previously listed here (optional
  `subject`, listener-as-own-subject, keying phase effects off something other than `activation`)
  are rejected — each papers over a derivation that should not exist.
- **`EFFECT_INVOKED` timing** — main-phase-only vs a general timing marker.
- ~~**`SUBJECT_COUNT` shape**~~ — **SETTLED AND SHIPPED 2026-08-07.** The bare leaf
  (`{ kind: "SUBJECT_COUNT" }` → `subjects.length`, **throws** when subjects are absent). A
  consumption-side `filter?: CardFilter` was rejected: the subjects were already filtered by the
  activation's `SubjectMatch`, and re-narrowing them at read time would evaluate against a
  post-mutation board. Scaling is `MULTIPLY(SUBJECT_COUNT, LITERAL n)`. Note the throw is load-bearing
  — `?? 0` would answer "none were carried" to a question that had no answer.

# Known bugs, not blocking
- **Deckout timing.** `emit` checks after EVERY signal and ends the game the moment a deck is empty,
  so drawing your last card loses immediately. OPTCG's rule is losing when you MUST draw and cannot.
  Pinned by an integration test that documents current behaviour.
- **`toCardDef` does not normalise case.** Remote data sends `"Blue"`/`"Slash"`; engine unions are
  `'BLUE'`/`'SLASH'`. Any card built through that path has colours no `COLOR` filter will match.
  Silent, because the `Card` type mis-declares the remote shape. `name`/`types` stay as printed.
- **`cost: null` vs `undefined`** — leaders come back with `null` where `CardDef` declares
  `cost?: number`. Check `calculateCost`.
- Evaluator: `base` flag ignored on COST/POWER/COUNTER filters — snapshots now carry both forms, so
  it is one line per branch.
- ~~`RANGE` AmountExpression throws~~ — **now dead, delete it.** `min` + `capacity` as separate fields
  on `PLAYER_CHOICE_TARGET` replaced its only purpose. Leaving a throwing member in the union invites
  someone to reach for it.
- **`SUBMIT_REORDER` has no reducer case.** It is in `GameAction`, in `validActions[REORDER]`, has a
  validator case with a permutation check, and is generated by `genChooseReorder` — but the reducer
  switch has no arm for it and no `default`, so it falls through, applies nothing, and the decision
  point is consumed anyway. Latent only because no `REORDER` decision point is ever set. Live the
  moment `LOOK` lands.

# Remaining backlog (each = new step-kind/gate + own tests)
*Detail for the table in "What's left, in order" §3 — that section owns the ordering, this one owns
the specifics.*

Costs/payments (7 `EffectCost` kinds) → PAYMENT step, test the abort branch · targeting
(`evalTargetExpression`, `CHOOSE_TARGETS`, TARGET binding) · `optional` decline + `oncePerTurn` ·
remaining resolution ops (LOOK, REORDER, ADD_TO_HAND) · status effects subsystem (apply/read/expire,
wire into cost/counter/power calc) · **ChoiceStep** (sole purpose: emit a decisionPoint between 2+
choices; the answer drives a `goto` to the chosen labelled branch — the modal keystone) ·
**`CardFilter.value` → `AmountExpression`** (agreed end state; uniform comparand unlocks
relational/REF/CARD_STAT/COUNT comparands — real migration, time it WITH CARD_STAT) · **CARD_STAT**
(value extraction from a bound card, read LIVE; `bind` writes → `REF` reads identity/set →
`CARD_STAT` reads a stat off it).
