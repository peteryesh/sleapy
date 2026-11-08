# Effect authoring invariants

The rule set for the **effect definition validator** — the static pass over `EffectDef`s that the plan
calls the *effect analyzer*. It becomes load-bearing once effects move from hand-written TypeScript to
data, because TypeScript is currently absorbing some of this for free and will stop.

Design rationale lives in `EFFECT_PLAN.md` under "Settled design decisions". This file is the checklist:
what to assert, what breaks when it is violated, and whether a check is even possible.

## Why a validator at all

Nearly every invariant here fails **silently and plausibly**. The effect resolves, the game continues,
and the card does something — just not the right thing. That is the defining property of this class of
bug and the reason it needs a pass of its own: playtesting finds it late and blames the wrong component.

**Everything checkable is an ERROR, not a warning.** The severity of the *symptom* and the severity of
the *risk* run in opposite directions here — a loud failure is fixed within the minute, a quiet one
ships — so the quiet ones must not be downgraded to advisory. Once the validator is a build gate the
distinction has no meaning anyway.

Status column:

- **ready** — writable today against the current types
- **blocked** — needs a type or mechanism that does not exist yet (named in the row)
- **review** — not statically decidable; enforce by convention and code review
- **type** — already enforced by the compiler; listed so it is not re-implemented

---

## Data flow — `bind` / `REF` / `locals`

`bind?: string` on `BaseStep` is the write; `REF` is an **expression leaf** (in `TargetExpression` /
`CardFilter` / `AmountExpression`) and is the read. Binding is the *stepper's* job, not the operation's:
the operation reports what it applied, and the stepper stores that under `bind`. Neither is needed until
a value must outlive its producing step — rungs 2–6 keep a paused selection in `EffectContext.selected`
and consume it in the same step.

| id | invariant | failure mode | status |
|---|---|---|---|
| **DF-1** | Every `REF` is bound by a step that **dominates it on all paths** | unbound read — `undefined` flows into a target expression or an amount | blocked: `REF`, terminals/`goto` |
| **DF-2** | Every `bind` has at least one reader | dead bind. The *quiet* half of the pair, and therefore the more dangerous one: it ships | blocked: `REF` |
| **DF-3** | A `REF`'s `EffectValue` kind matches its host position | a `NUMBER` consumed where a card set was expected | blocked: `EffectValue` union |
| **DF-4** | The activation's `subjects` are **not** routed through `locals`/`REF` | two channels for one thing. Subjects are always present and need no path analysis; `REF` is for step-produced data only | review |

DF-1 must be **path-aware def-use over the jump graph**, not a linear scan — once `goto`/labels exist a
`REF` can be bound on one branch and not another, and a linear walk pronounces it fine.

DF-2 is largely redundant with DF-1 in the typo case (misspell the reader and both fire). It earns its
keep when the reader was *deleted* during editing and the effect now silently does less than it reads
like — which DF-1 cannot see.

**Precondition for DF-3:** `locals` is `Record<string, any>` today. It must become
`Record<string, EffectValue>` with `EffectValue = CARDS | SNAPSHOTS | NUMBER | BOOL` before DF-3 can be
expressed at all. `any` locals is the trap the plan names explicitly.

## Payment and cost structure

| id | invariant | failure mode | status |
|---|---|---|---|
| **PAY-1** | Every `PaymentStep` is covered by a preceding requirement | a cost the board cannot pay is offered; under the no-rewind rule the player loses whatever was already applied | blocked: requirement-kind split |
| **PAY-2** | The affordability gate is **derived** from the payment's own `TargetExpression`, never hand-written | Requirement/Payment drift, and the double-count trap. Diverges the first time either side is edited | review |
| **PAY-3** | In a multi-part cost, **no payment step after the first** may be `optional` | declining part 2 after part 1 has applied leaves the player having paid for nothing — there is no rewind | ready |
| **PAY-4** | A multi-part cost's covering requirement tests the **conjunction** of all parts | the self-inflicted partial-payment case: part 1 applies, part 2 has no legal target, the card is lost to nothing | automatic under PAY-2, else review |
| **PAY-5** | One cost part per `PaymentStep`; multi-line costs are sequential mandatory steps in card order | no `ALL` combinator — keeps `cursor` a single int | type (once `EffectCost` collapses) |

PAY-3 currently rests on **decline meaning `abort`**: under a flat step list, declining an optional
payment ends the effect, which is what makes "decline part 1" correctly skip part 2 with no grouping
construct. The invariant survives branching but its statement does not — once `ChoiceStep` lands,
decline becomes a jump, and the rule must be restated against the **commitment point** rather than
against position-in-list.

## Control flow and terminals

`done` and `abort` are distinct terminals because they differ in post-conditions, not in destination —
which is why neither is expressible as `goto: 'END'` plus a flag:

| terminal | consumes the `oncePerTurn` use | legal past the consumption boundary |
|---|---|---|
| `done` | yes | yes |
| `abort` | **no** | **no** |

| id | invariant | failure mode | status |
|---|---|---|---|
| **CTRL-1** | `abort` never appears after the **consumption boundary** (the cursor entering the first `ResolutionStep`) | an effect un-consumes a `oncePerTurn` use it already committed. 290 cards carry `oncePerTurn`, and a card that silently refreshes is subtly wrong in play rather than crashy | blocked: terminals |
| **CTRL-2** | All gating conditions precede any cost | invariant 3's precondition. Satisfied by construction when the gate lives in `def.condition` — violated by a *gating* `RequirementStep` placed after a `PaymentStep` | blocked: requirement-kind split |
| **CTRL-3** | Every `goto` target exists; no unreachable steps | ordinary dead code and dangling jumps | blocked: `goto`/labels |
| **CTRL-4** | Flat step list — no nested step groups | `cursor` must stay a single int or resume stops being trivial | review (shape rule, not per-card) |

## Activation

| id | invariant | failure mode | status |
|---|---|---|---|
| **ACT-1** | If **any** expression in the effect contains `SUBJECT_COUNT`, **every** member of `activation[]` is the subject-carrying arm | `activation` is an **array**. The card works off the subject-carrying signal and throws off the other one. Found late, blamed on the wrong thing | ready |
| **ACT-2** | A `SignalPredicate` is only authored where the signal can report that field | asking for a field the signal does not carry **fails** rather than matches, so the effect never fires and nothing says why. Decidable per signal type | ready |
| **ACT-3** | `subject` is mandatory on the subject-carrying arm | a forgotten filter turns "when **this** is played" into "when **anyone** plays a Character" | type |
| **ACT-4** | `ALL_OF` is a pure gate — its payload is the full raw set, not the filtered subset | authoring `ALL_OF` and expecting a narrowed payload. (The empty-set rejection is runtime, in `selectSubjects`) | review |
| **ACT-5** | An activation listing `EFFECT_INVOKED` must specify `invoked` | omit it and the effect stages on **every** invocation by **anyone** — signal matching is card-scoped while invocation is effect-scoped, so two `[Activate: Main]` abilities on one card otherwise both fire when either is invoked. Same overreach class as a forgotten `subject` | ready (once `EFFECT_INVOKED` exists) |

## Selection and targeting

| id | invariant | failure mode | status |
|---|---|---|---|
| **SEL-1** | `min <= capacity` | an unsatisfiable selection. Statically decidable only when both are `LITERAL`; otherwise runtime | ready (literal case) |
| **SEL-2** | When `weight` is set, `min` and `capacity` are in **weight units**, not picks | `min: 2, weight: "COST"` means "at least 2 **cost**", not "at least 2 cards" — and reads exactly like the thing it is not | **unenforceable** |
| **SEL-3** | `ChoiceStep` does **not** inherit the single-candidate auto-resolve shortcut | "take top or bottom of life" with one life card has a unique *card* but two distinguishable *labels*, and a later effect can read which was chosen. Outcomes must be unique in everything observable | review (implementation rule) |

SEL-2 is the clearest case for the general remedy below: mixed-unit constraints were supposed to be a
`limits: []` generalization, which is not built, and no check can recover the author's intent from
`min: 2`.

## Zone and timing

| id | invariant | failure mode | status |
|---|---|---|---|
| **ZONE-1** | `activeZone` is the zone the listener occupies **at emit time** | authoring `HAND` for an event looks correct and stages nothing, because `playEvent` moves the card to `TRASH` before emitting `EVENT_PLAYED`. Event ⇒ `TRASH`, On-Play ⇒ `CHARACTERS`, On-K.O. ⇒ `TRASH` | ready for known signal/class pairs |

---

## What no check can reach

The `review` and `unenforceable` rows share a property: the author's *intent* is not recoverable from
the definition. SEL-2 is the purest example — `min: 2` is well-formed under either reading.

For those, the long-run answer is a **shape change that makes the wrong thing unsayable**, not a check
that catches it. That is the same argument that split `CardFilter`'s stat members into computed/base
pairs instead of keeping a `base` boolean: the distinction produces subtly wrong gameplay when wrong, so
it belongs at the authoring site rather than in a field someone has to keep straight. Treat a growing
`review` list as pressure on the types, not as a backlog of lints to write.

## Blocked-on summary

Nothing here is wasted effort today, but most of it cannot be *written* yet. In dependency order:

1. **`EffectValue` union + typed `locals`** → unblocks DF-3
2. **`REF` expression leaf** → unblocks DF-1, DF-2
3. **Requirement-kind split** (authored gating vs derived affordability) → unblocks PAY-1, CTRL-2
4. **`done`/`abort` terminals, `goto`/labels** → unblocks CTRL-1, CTRL-3, and makes DF-1 path-aware

**Writable right now, against current types:** PAY-3, ACT-1, ACT-2, SEL-1 (literal case), ZONE-1. ACT-1
is the highest value of those — it is subtle, it is fully decidable, and its failure mode is a card that
works most of the time.

**ACT-5 is the one row a DESIGN DECISION depends on.** Invocation routes through `emit` rather than
staging directly specifically because the omission hazard of `invoked: "SELF"` is statically catchable
(see "Invocation goes through `emit`" in `EFFECT_PLAN.md`). It needs only the `EFFECT_INVOKED` signal to
exist, which is a one-member addition — so write ACT-5 *with* that signal, not after it. Shipping the
predicate without the check reinstates the silent failure the uniform path was chosen on the strength of
avoiding.
