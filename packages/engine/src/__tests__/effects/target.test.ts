import { describe, it, beforeEach } from "vitest";
import { advance } from "../../conductor";
import { reducer } from "../../reducer";
import { getLegalActions } from "../../actionGen";
import { decrementCapacity, isValidSelection } from "../../game/effects/selection";
import type { CardInstanceId, GameState, PlayerId, TargetExpression } from "../../types";
import {
    STAT_CARD,
    capacityOf,
    cardsLimit,
    makeEvalContext,
    makeTargetBoard,
    makeTargetedStep,
    makeTargetingBoard,
    parkEffect,
    playerChoice,
    resetIds,
    sortedIds,
    weightedLimit,
    type TargetBoard,
} from "../helpers";

// PLAYER_CHOICE_TARGET from the point an effect is already resolving and its cursor
// reaches a targeted step: whether a pick is legal, how the prompt is raised, how the
// loop re-enters and ends, and how capacity is derived from the picks so far.
//
// Candidate listing (evalTargetExpression) is covered in
// evaluators/targetExpression.test.ts; this file assumes it.
//
// HOW THE FLOW IS DRIVEN. An effect is parked at cursor 0 (no staging), advance()
// runs it to its first decision point, and every pick is an action taken FROM
// getLegalActions and applied through the reducer — the same path a client takes.
// Assertions read what the player is offered and what the board did, not the
// cursor: the one exception is the labelled test that reads `selected` directly.
//
// BLOCKED ON REST. The targeted step's operation is REST, the one targeted operation
// that does not throw once selection ends — but it is still a no-op. Tests that need
// the operation to have DONE something stay todo until REST is implemented.

const SELF: PlayerId = "p1";
const OPP: PlayerId = "p2";

beforeEach(() => {
    resetIds();
});

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

// Parks a one-step effect whose operation targets with `target`, and runs the
// engine to its first decision point: EFFECT_TARGET if anything is pickable,
// otherwise straight through the step to MAIN_ACTION.
function startTargetedEffect(board: TargetBoard, target: TargetExpression): GameState {
    return advance(parkEffect(board, { steps: [makeTargetedStep(target)] }));
}

// The card ids the decision point's player is currently offered, sorted.
function offeredTargets(state: GameState): CardInstanceId[] {
    const player = state.decisionPoint?.player;
    if (!player) return [];
    return sortedIds(
        getLegalActions(state, player).flatMap(a => (a.type === "CHOOSE_TARGET" ? [a.instanceId] : [])),
    );
}

// Picks `instanceId` as the decision point's player, through the reducer. Throws if
// the card is not on offer, so a test can never pick something the engine would
// not have offered.
function choose(state: GameState, instanceId: CardInstanceId): GameState {
    const player = state.decisionPoint?.player;
    if (!player) throw new Error(`choose called with no decision point`);
    if (!offeredTargets(state).includes(instanceId)) {
        throw new Error(`${instanceId} is not offered — offered: ${offeredTargets(state).join(", ")}`);
    }
    return reducer(state, { type: "CHOOSE_TARGET", playerId: player, instanceId });
}

// Referenced so the imports stay live until the todos below are written.
void [SELF, OPP, STAT_CARD, capacityOf, cardsLimit, weightedLimit, playerChoice, makeEvalContext,
    makeTargetBoard, makeTargetingBoard, decrementCapacity, isValidSelection, startTargetedEffect, choose];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("isValidSelection", () => {
    it.todo("accepts a card in one of the targeted zones");
    it.todo("rejects a card outside the targeted zones");
    it.todo("accepts a card within a CARDS limit");
    it.todo("rejects any card once CARDS capacity is 0");
    it.todo("accepts a card whose weight is within a WEIGHTED limit");
    it.todo("rejects a card whose weight exceeds a WEIGHTED limit");
    it.todo("rejects a card already in selected on the effect context");
});

describe("decision point", () => {
    it.todo("a step targeting with PLAYER_CHOICE_TARGET sets an EFFECT_TARGET decision point");
    it.todo("chooser SELF makes the effect owner the decision point player");
    it.todo("chooser OPPONENT makes the other player the decision point player");
});

describe("prompt loop through the reducer", () => {
    it.todo("executes the operation when its one limit is exhausted");
    it.todo("executes the operation when all of multiple limits are exhausted");
    it.todo("executes the operation when one of multiple limits is exhausted");
    it.todo("executes the operation when no limit is exhausted but no candidate is valid");
    it.todo("executes the operation (fizzles) when there are no valid targets to begin with");
    it.todo("does not advance the step while limits are not exhausted");
    it.todo("does not offer an already-selected card while limits are not exhausted");
    it.todo("keeps the EFFECT_TARGET decision point while limits are not exhausted");
});

describe("operation receives the selection", () => {
    // Blocked on REST — see the file header.
    it.todo("selected is present when the operation runs");
    it.todo("the operation is applied to every selected card and nothing else");
    it.todo("selected includes cards from both sides, applies to all");
    // The one test that reads `selected` directly, pinning that it is cleared at the
    // end of the step.
    it.todo("selected is cleared after the step ends");
});

describe("derived capacity (decrementCapacity)", () => {
    it.todo("CARDS: each selected card decrements capacity by 1");
    it.todo("WEIGHTED POWER: each selected card decrements capacity by its power");
    it.todo("CARDS and WEIGHTED POWER together are each decremented by the same selection");
    it.todo("WEIGHTED: a zero-weight card is allowed and leaves capacity unchanged");
    it.todo("WEIGHTED: a negative-weight card is allowed and increases capacity");
});

describe("early termination of target selection", () => {
    it.todo("Targets available, no targets selected, stopping early executes operation (fizzles)");
    it.todo("Targets available, some targets selected, stopping early executes operation");
    it.todo("No valid targets, min value not satisfied"); // should not throw error, but should 
    it.todo("Min value set and not satisfied, early termination fails");
    it.todo("Min value set and satisfied, early termination succeeds");
});