import type { DecisionPoint, EffectContext, EffectOperation, EvalContext, GameState } from "../../types";
import { evalAmountExpression, evalTargetExpression } from "../../evaluator";
import { cardsDraw } from "../operations";
import { decrementCapacity, isValidSelection, targetOf } from "./selection";
import { clearSelectedTargets, setDecisionPoint } from "../mechanics";

// Translates "whose effect is resolving" into the two things the expression
// evaluators need: `self` answers "whose side" (CONTROLLER filters, and who acts
// for player-scoped operations), `source` answers "which card" (THIS).
//
// The staging gate builds the same pair by hand for each listener; this is the
// version derived from an effect that has already been promoted.
export function evalContextOf(effectContext: EffectContext): EvalContext {
    return {
        self: effectContext.playerId,
        source: effectContext.instanceId,
        // A resolving effect ALWAYS has a signal in scope, so this is always present —
        // possibly `[]`, which means the signal named nothing, not that there was no
        // signal. Dropping this line is the silent failure in the whole chain: every
        // SUBJECT_COUNT would start throwing "no activating signal" instead of
        // counting.
        subjects: effectContext.subjects,
    };
}

// The adapter from EffectOperation data on a card definition to an operation call.
// Runs exactly one operation and returns state.
//
// It receives the operation, never the step, so it cannot reach the cursor, `bind`
// or `label` — advancing through the step list belongs to the stepper.
//
// Note that no operation takes a player argument: who acts is derived from the
// expressions via `self`, so an effect that makes the opponent act says so through
// its filters rather than through a parameter here.
export function executeResolution(state: GameState, effectContext: EffectContext, operation: EffectOperation): GameState {
    const targetExpression = targetOf(operation);
    if (targetExpression?.kind === "PLAYER_CHOICE_TARGET") {
        const newTargetExpression = structuredClone(targetExpression);
        for (const limit of newTargetExpression.limits) {
            if (effectContext.selected) {
                for (const cardId of effectContext.selected) {
                    decrementCapacity(state, cardId, limit);
                }
            }
        }
        let deciderId = effectContext.playerId;
        if (newTargetExpression.chooser === "OPPONENT") {
            // get first player that is not the effect context player
            deciderId = state.config.playerIds.find(id => !(id === effectContext.playerId))!;
        }
        const evalContext = evalContextOf(effectContext);
        const targets = evalTargetExpression(state, evalContext, newTargetExpression);
        if (targets.some(target => isValidSelection(state, evalContext, newTargetExpression, target))) {
            const dp: DecisionPoint = {
                type: "EFFECT_TARGET",
                player: deciderId,
                constraint: newTargetExpression
            }
            return setDecisionPoint(state, dp);
        }
    }
    
    const evalContext = evalContextOf(effectContext);
    switch (operation.type) {
        case "DRAW": {
            const amount = evalAmountExpression(state, evalContext, operation.amount);
            // EFFECT, not RULE — emit reads cause.sourceId to attribute wins, so
            // movement caused by an effect has to name the card that caused it.
            state = cardsDraw(state, evalContext.self, amount, { kind: "EFFECT", sourceId: effectContext.instanceId });
            break;
        }
        case "REST":
            // differentiate the type of card being rested
            // set state to the operation that rests cards
            // base the cards to be rested on the target expression type
            // read selected from the effect context if it was player choice
            // grab from zones and target expression of selector target
            // affect self card if self target
            break;
        case "ADD_TO_HAND":
        case "TRASH":
        case "KO":
        case "RETURN_DON":
        case "LIFE_TO_HAND":
        case "LIFE_TRASH":
        case "LIFE_FLIP":
        case "LOOK":
        case "REORDER":
            throw new Error(`Effect operation ${operation.type} is not yet implemented`);
        default:
            throw new Error(`Effect operation type not recognized`);
    }
    return state;
}
