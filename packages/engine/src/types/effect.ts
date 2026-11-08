import type { CardInstanceId, PlayerId, Zone, Keyword, StackPosition, CardId, LifeOrientation, Phase } from './primitives';
import type { GameSignal, SignalCause, SignalType } from './signal';
import type { CardSnapshot } from './card';
import type { CardFilter, Condition, AmountExpression, TargetExpression } from './expression';

export type EffectId = string;

// Effect as it is stored on the database
// Effect is stored on the definition as Record<EffectId, EffectDef>
export type EffectDef = {
    condition?: Condition;
    steps: EffectStep[];
    activation: SignalActivation[];
    activeZone: Zone;
    oncePerTurn: boolean;
}

/**
 * An effect that has activated — built once at staging and carried unchanged through
 * the staging frame, the queue, and resolution. ONE type for the whole life, not a
 * reference that is later transformed into a context.
 *
 * The former `EffectRef` split (a pointer while queued, a context once promoted) was
 * removed because it bought nothing: `steps` is a reference into the immutable
 * definition rather than a copy, so the "cheap" form saved no allocation, and
 * promotion had to construct the real thing anyway. Collapsing also makes promotion
 * an exact object-identity splice instead of a lookup by `instanceId`, which is what
 * previously mis-selected between two effects on the same card.
 *
 * `cursor: 0` on a queued effect is not a claim that it has started — position says
 * that. Queued lives in `effectQueue`, running lives in `currentEffect`.
 */
export type EffectContext = {
    condition?: Condition;
    steps: EffectStep[];
    playerId: PlayerId;
    effectId: EffectId;
    instanceId: CardInstanceId;
    /**
     * What the effect activated ON, frozen as of the instant before its cause took
     * effect — exactly the subjects that satisfied the activation's `SubjectMatch`,
     * never the raw set the signal named.
     *
     * REQUIRED, and `[]` is legal. Coherent because of STAGE-ONCE: one context per
     * event regardless of how many subjects there were, so there is always exactly
     * one array to fill. `[]` means "activated, carries nothing" — the normal state
     * for a phase-keyed effect — and is not the same as "did not activate", which
     * never produces a context at all.
     */
    subjects: CardSnapshot[];
    cursor: number;
    selected: CardInstanceId[] | null; // for steps that require player selection, store the selected cards here
    locals: Record<string, any>;
}

export type EffectFrame = Record<PlayerId, EffectContext[]>;

export type EffectStep =
    | RequirementStep
    | PaymentStep
    | ResolutionStep;

interface BaseStep {
    bind?: string;
    label?: string;
}

// Requirement step is a conditional check on board condition
// Requirement step preceding a payment step should check for the ability to pay the cost
export interface RequirementStep extends BaseStep {
    kind: "REQUIREMENT";
    requirement: Condition;
}

const COST_OPERATIONS = [
    "REST", "TRASH", "ADD_TO_HAND", "RETURN_DON", "LIFE_TO_HAND", "LIFE_TRASH", "LIFE_FLIP"
]

export type CostOperation = Extract<EffectOperation, { type: typeof COST_OPERATIONS[number] }>;

// Payment must always be preceded by requirement
// Payment step is a cost that must be paid to activate the effect, if it fails, the effect is aborted
// Cost does not require a check because it should already have been checked in the requirement step
export interface PaymentStep extends BaseStep {
    kind: "PAYMENT";
    operation: CostOperation;
    optional: boolean; // If true, the player can choose to skip this payment step and not activate the effect
}

// Step to resolve the effect post requirement and payment, if any
// Contains the actual functionality of the effect
export interface ResolutionStep extends BaseStep {
    kind: "RESOLUTION";
    operation: EffectOperation;
}

export type EffectOperation =
    // Procedural game operations
    | { type: "REORDER"; from: "LOOK"; to: Zone; toPos: StackPosition }
    | { type: "LOOK"; from: Zone; fromPos?: StackPosition; amount: AmountExpression }
    | { type: "DRAW"; amount: AmountExpression }
    // Operations that are able to be used as a cost for effect
    | { type: "ADD_TO_HAND"; target?: TargetExpression; reveal?: boolean }
    | { type: "REST"; target?: TargetExpression }
    | { type: "TRASH"; target?: TargetExpression }
    | { type: "RETURN_DON"; target?: TargetExpression }
    | { type: "LIFE_TO_HAND"; amount: AmountExpression; lifePos: StackPosition }
    | { type: "LIFE_TRASH"; amount: AmountExpression; lifePos: StackPosition }
    | { type: "LIFE_FLIP"; amount: AmountExpression; lifePos: StackPosition; orientation: LifeOrientation }


/**
 * ONE FILTER, TWO CONSUMERS. The wrapper's `kind` is the quantifier — it decides
 * whether the effect activates at all — while the `filter` inside decides which
 * subjects get carried. Making the cardinality explicit at the authoring site is the
 * point: deriving "did it activate" from "did the payload come back empty" is what
 * made "activated, carries nothing" unrepresentable.
 *
 * ANY_OF is existential — at least one subject must match, and the matches are the
 * payload.
 * ALL_OF is universal — every subject the signal named must match, and the payload is
 * the full raw set, so it is a pure gate refinement that buys nothing on the carrying
 * side. An EMPTY raw set FAILS it; otherwise it is vacuously true and would fire on
 * every signal that named nothing.
 */
export type SubjectMatch =
    | { kind: "ANY_OF"; filter: CardFilter }
    | { kind: "ALL_OF"; filter: CardFilter };

// The signal types that carry their subjects, derived structurally from the signal
// union rather than listed by hand, so it cannot drift as categories are migrated.
type SubjectCarryingSignal = Extract<GameSignal, { subjects: CardSnapshot[] }>["type"];

/**
 * TIER 1 — the optional predicates over the SIGNAL, shared by both activation arms.
 * Cheap boolean tests that touch no cards, and an omitted one matches anything. Tier 2
 * is `SubjectMatch`, which tests cards and is the only tier that produces a value.
 *
 * causeKind and source are two DIFFERENT checks, not one. A filter alone cannot tell
 * "caused by a player" from "caused by an effect": with no sourceId to test it simply
 * fails, conflating no-cause with wrong-cause. (Note this is not the `CausePredicate`
 * wrapper that EFFECT_PLAN.md rejected — the two stay separate fields.)
 *
 * Every one FAILS rather than matches when the signal cannot report the field it asks
 * for. A definition error must not fire on everything.
 */
export type SignalPredicates = {
    causeKind?: SignalCause["kind"][];   // PLAYER | BATTLE | EFFECT | OVERFLOW | RULE
    source?: CardFilter;                 // the causing card, where the cause names one
    fromZone?: Zone[];                   // origin — the card itself can no longer say
    phase?: Phase[];                     // the phase being ENTERED, for phase-keyed effects
};

/**
 * What an effect listens for, in two tiers: `signal` plus `SignalPredicates`, then
 * `subject`.
 *
 * DISCRIMINATED on whether the signal carries subjects, which falls out of the signal
 * union for free. A phase-keyed activation has no `subject` field *because the type
 * says the signal names no card*, and that is what lets a subject-less signal activate
 * an effect at all.
 *
 * `subject` is MANDATORY on the carrying arm, deliberately. An optional filter makes a
 * forgotten one silent, and the effect it breaks is On-Play — "when this is played"
 * would quietly become "when ANYONE plays a character".
 *
 * BATTLE IS NOT MODELLED HERE, AND THAT IS THE DESIGN. Combat signals name cards in
 * several distinct roles (attacker vs defender), which neither arm expresses, so they
 * fall into the subject-less arm and `selectSubjects` throws for them. That throw is a
 * PERMANENT ASSERTION, not a migration TODO: "when attacking" and "on opponent's
 * attack" are PHASE-KEYED — they watch a battle phase through `phase` and read
 * `state.currentBattle` at resolution. Do NOT "fix" the throw by pushing combat into
 * the flat-subjects arm. If a card ever genuinely needs role-filtered subjects it gets
 * its own arm naming which role it filters, over named `CardSnapshot` fields on the
 * signal — never a role tag added to `subjects`.
 */
export type SignalActivation =
    | (SignalPredicates & {
        signal: SubjectCarryingSignal;
        subject: SubjectMatch;
    })
    | (SignalPredicates & {
        signal: Exclude<SignalType, SubjectCarryingSignal>;
    });

// export type EffectValue =
//     | { kind: "CARDS"; value: CardInstanceId[] }
//     | { kind: "SNAPSHOTS"; value: CardSnapshot[] }
//     | { kind: "NUMBER"; value: number }
//     | { kind: "BOOL"; value: boolean }


// Status Effects
export type StatusEffectDef = {
    effectId: EffectId;
    type: StatusEffectType;
    modification: Modification;
    expiration: EffectDuration | null;
    affects?: CardFilter;
}

export type StatusEffect = {
    playerId: PlayerId;
    effectId: EffectId;
    instanceId: CardInstanceId;
    type: StatusEffectType;
    modification: Modification;
    expiration: EffectDuration | null;
    affects?: CardFilter;
}

export type EffectDuration =
    | { expiration: "END_OF_BATTLE" }
    | { expiration: "END_OF_REFRESH" }
    | { expiration: "END_OF_MAIN" }
    | { expiration: "END_OF_TURN" }
    | { expiration: "START_OF_NEXT_TURN" }
    | { expiration: "END_OF_NEXT_TURN" }
    | { expiration: "END_OF_OPP_NEXT_MAIN" }
    | { expiration: "END_OF_OPP_NEXT_TURN" }

export type Modification =
    | { type: "KEYWORD"; keyword: Keyword }
    | { type: "POWER"; amount: AmountExpression }
    | { type: "BASE_POWER"; value: AmountExpression }
    | { type: "COST"; amount: AmountExpression }
    | { type: "BASE_COST"; value: AmountExpression }
    | { type: "BASE_COUNTER"; value: AmountExpression }
    // add statuses here (cannot attack, cannot rest, cannot block, can attack active, etc.)

export type StatusEffectType =
    | { type: "INNATE" } // Keywords
    | { type: "PROJECTION" } // Sits on card definition, affects all other cards
    | { type: "MARK" } // Lives in state, has an expiration and is resistant to suppression