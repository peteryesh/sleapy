import type { CardClass, Color, Attribute, Zone, CardInstanceId, PlayerId } from './primitives';
import type { CardSnapshot } from './card';

export type EvalContext = {
    self: PlayerId;
    source: CardInstanceId;
    /**
     * What the activating signal was about, if there IS an activating signal in scope.
     *
     * OPTIONAL, and the distinction is load-bearing: absent means "no signal in
     * scope", which is NOT the same as "the signal named nothing" (that is `[]`). Two
     * callers are legitimately signal-less — the staging gate, which is still deciding
     * what the subjects are, and `StatusEffectDef.affects`, which never has one.
     * Handing those `[]` would make `SUBJECT_COUNT` answer 0 instead of reporting that
     * the question was unanswerable.
     */
    subjects?: CardSnapshot[];
};

export type ComparisonOp = ">=" | "<=" | "==" | ">" | "<";

export type CardFilter =
    | { kind: "ANY" }
    | { kind: "THIS" }
    | { kind: "CONTROLLER"; controller: "SELF" | "OPPONENT" | "ANY" }
    | { kind: "NAME"; name: string }              // checks name and aliases
    | { kind: "CLASS"; cardClass: CardClass }
    // Stat comparisons come in COMPUTED / BASE pairs rather than one member carrying a
    // `base` flag. The flag existed, was read incorrectly for a long time, and nothing
    // caught it — which is the whole argument. A wrong boolean here produces a card that
    // is subtly wrong in play rather than one that crashes, so the distinction has to be
    // visible at the authoring site instead of maintained in a field.
    //
    // COMPUTED reads the card as it is: power with DON attached, cost after reduction.
    // BASE reads what is printed. Both come off the snapshot, so both answer as of
    // whenever it was captured — live evaluation is just a snapshot taken now.
    | { kind: "COST"; op: ComparisonOp; value: number }
    | { kind: "BASE_COST"; op: ComparisonOp; value: number }
    | { kind: "POWER"; op: ComparisonOp; value: number }
    | { kind: "BASE_POWER"; op: ComparisonOp; value: number }
    | { kind: "COUNTER"; op: ComparisonOp; value: number }
    | { kind: "BASE_COUNTER"; op: ComparisonOp; value: number }
    | { kind: "COLOR"; color: Color }
    | { kind: "TYPE"; cardType: string }          // OPTCG group/affiliation
    | { kind: "ATTRIBUTE"; attribute: Attribute }
    | { kind: "RESTED"; isRested: boolean }
    | { kind: "FLIPPED"; isFlipped: boolean }
    | { kind: "AND"; filters: CardFilter[] }
    | { kind: "OR"; filters: CardFilter[] }
    | { kind: "NOT"; filter: CardFilter };

    
    // Can be compositions of expressions
    // MULTIPLY can be COUNT * LITERAL, LITERAL * LITERAL but what would be the point
export type AmountExpression =
    | { kind: "LITERAL"; value: number } // literal number, hard coded
    | { kind: "COUNT"; zones: Zone[]; filter: CardFilter } // count based on some game state value
    // How many subjects the activating signal carried — "draw 1 for each card
    // trashed". A BARE LEAF on purpose: it has no `filter`, because the subjects were
    // already filtered by the activation's SubjectMatch, and re-narrowing them here
    // would read a post-mutation board. Scaling is MULTIPLY(SUBJECT_COUNT, LITERAL n).
    | { kind: "SUBJECT_COUNT" }
    | { kind: "ADD"; left: AmountExpression; right: AmountExpression }
    | { kind: "SUBTRACT"; left: AmountExpression; right: AmountExpression }
    | { kind: "MULTIPLY"; left: AmountExpression; right: AmountExpression }
    
/**
 * A boolean expression. NOT board-specific despite where it is used — nothing in this
 * type reads the game. Its reach is entirely determined by `AmountExpression`'s leaves:
 * `COUNT` reads zones, `SUBJECT_COUNT` reads the activating signal, and future leaves
 * read whatever they read.
 *
 * The practical consequence: **widening what a condition can ask about means adding an
 * AmountExpression leaf, never adding a member here.** This union should stay at four.
 *
 * Used as the activation gate (`EffectDef.condition`), as a mid-resolution conditional
 * (`RequirementStep.requirement`), and — once it exists — as the status subsystem's
 * "while this is true" predicate and the gate on static abilities (`Your Turn` 97
 * cards, `Opponent's Turn` 76).
 */
export type Condition =
    | { kind: "AND"; conditions: Condition[] }
    | { kind: "OR"; conditions: Condition[] }
    | { kind: "NOT"; condition: Condition }
    /**
     * Replaced `ZONE_SIZE`, which could express neither real example: it had no
     * comparison operator ("8 or more" vs "5 or less") and no controller scoping
     * ("YOUR hand"). `COUNT` already scopes through a `CONTROLLER` filter, so
     * `ZONE_SIZE` was strictly weaker than what this gets for free.
     *
     * Two expressions rather than expression-vs-literal also buys relational
     * comparisons: "if you have more Characters than your opponent" is
     * COUNT(SELF) > COUNT(OPPONENT).
     *
     * Existence checks funnel through here too — "if your Leader is {Straw Hat Crew}"
     * is COUNT([LEADER], AND(SELF, TYPE ...)) >= 1. Deliberately no `EXISTS` sugar:
     * it would be `>= 1` with no new expressive power.
     */
    | { kind: "COMPARE"; op: ComparisonOp; left: AmountExpression; right: AmountExpression };

/**
 * Which numeric stat to read off a card.
 *
 * The six members correspond exactly to `CardSnapshot`'s numeric fields — `cost`/
 * `baseCost`, `power`/`basePower`, `counter`/`baseCounter` — so reading one is a direct
 * field lookup with no mapping table, and that correspondence is what bounds the union.
 *
 * Named rather than `{ stat, base }` for the same reason `CardFilter` splits its stat
 * members: base-vs-computed is a distinction that produces subtly wrong gameplay when it
 * is wrong, so it belongs in the name rather than in a boolean the author has to keep
 * straight.
 *
 * This is the SELECTOR alone — it names no card. The loop supplies each candidate when
 * it is used as a selection `weight`. The planned `CARD_STAT` AmountExpression is a
 * different thing that carries this type plus a reference to a bound card.
 */
export type CardStatType =
    | "COST" | "BASE_COST"
    | "POWER" | "BASE_POWER"
    | "COUNTER" | "BASE_COUNTER";

export type TargetExpression =
    |   { kind: "SELF_TARGET" } // Target's only self
    |   { kind: "SELECTOR_TARGET"; zones: Zone[]; filter?: CardFilter } // Affects all that meet criteria, no decision
    |   { 
            kind: "PLAYER_CHOICE_TARGET";
            zones: Zone[];
            filter?: CardFilter;
            min: AmountExpression; // minimum number of targets to select

            // an amount based on the defined weight that determines the upper bound of that weight that the sum of the targets are allowed to have
            // e.g. if the weight is POWER and the effect states that the maximum total power of the selected targets is 4000, the sum of the power of the selected targets must be less than or equal to 4000
            // if the weight is not defined, then the capacity defaults to the max number of targets that can be selected
            capacity: AmountExpression;

            weight?: CardStatType;
            chooser?: "SELF" | "OPPONENT";
        }