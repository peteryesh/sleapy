import type { GameState } from '../../types/state';
import type { GameAction } from '../../types/action';
import { InvalidActionError } from '../../errors';
import { playCard, donAttach, declareAttack, declareBlocker, playCounter, sendTriggerToHand, sendTriggerToTrash, enterWhenAttackingPhase, enterEndOfTurnPhase, enterOnOpponentAttackPhase, enterCounterPhase, enterBattleResolutionPhase, enterBlockerPhase, enterRefreshPhase, enterMainPhase, resolveBattle, enterStartOfTurnPhase, displaceCard } from '../operations';
import { getZoneArray, promoteEffect, pushSelectedTarget, selectQueuedEffect } from '../mechanics';


// Play card from hand
export function applyPlayCard(state: GameState, action: Extract<GameAction, { type: "PLAY_CARD" }>): GameState {
    return playCard(state, action.playerId, action.instanceId, { kind: "PLAYER" });
}

export function applyDisplaceCardOnField(state: GameState, action: Extract<GameAction, { type: "DISPLACE_ON_FIELD"}>): GameState {
    if (!state.decisionPoint) throw new InvalidActionError(`No decision point set for displacement`);
    if (state.decisionPoint.type !== "DISPLACE_CARD") throw new InvalidActionError(`Cannot displace card for decsion type: ${state.decisionPoint.type}`);
    return displaceCard(state, action.playerId, state.decisionPoint.playedCardId, action.displacedId);
}

// Attach DON
export function applyAttachDon(state: GameState, action: Extract<GameAction, { type: "ATTACH_DON" }>): GameState {
    const donIds = getZoneArray(state, action.playerId, "DON_ACTIVE").slice(0, action.count);
    return donAttach(state, action.playerId, donIds, action.targetId, "DON_ACTIVE", { kind: "PLAYER" });
}

// Declare attack
export function applyDeclareAttack(state: GameState, action: Extract<GameAction, { type: "DECLARE_ATTACK" }>): GameState {
    return declareAttack(state, action.playerId, action.attackerId, action.defenderId);
}

export function applyDeclareBlocker(state: GameState, action: Extract<GameAction, { type: "DECLARE_BLOCKER" }>): GameState {
    return declareBlocker(state, action.playerId, action.blockerId);
}

export function applyPlayCounter(state: GameState, action: Extract<GameAction, { type: "PLAY_COUNTER" }>): GameState {
    return playCounter(state, action.playerId, action.counterId);
}

export function applyCompleteBattle(state: GameState, action: Extract<GameAction, { type: "COMPLETE_BATTLE" }>): GameState {
    state = enterBattleResolutionPhase(state);
    return resolveBattle(state);
}

// Complete later
export function applyTriggerActivation(state: GameState, action: Extract<GameAction, { type: "ACTIVATE_TRIGGER" }>): GameState {
    if (!action.activate) {
        // decline trigger, move card from trigger zone to hand
        return sendTriggerToHand(state, action.playerId, { kind: "RULE" });
    }
    // move card from trigger zone to trash
    state = sendTriggerToTrash(state, action.playerId, { kind: "RULE" });
    // queue trigger effect
    // activateTrigger
    return state;
}

// Activate effect - stubbed for now
export function applyActivateEffect(state: GameState, action: Extract<GameAction, { type: "ACTIVATE_EFFECT" }>): GameState {
    throw new InvalidActionError("ACTIVATE_EFFECT is not yet implemented");
}

// End phase
export function applyNextPhase(state: GameState, action: Extract<GameAction, { type: "NEXT_PHASE" }>): GameState {
    // Validate here
    switch (state.phase) {
        case "MAIN":
            return enterEndOfTurnPhase(state);
        case "ON_OPPONENT_ATTACK":
            return enterBlockerPhase(state);
        case "BLOCKER":
            return enterCounterPhase(state);
        default:
            throw new InvalidActionError(`Cannot directly call pass state from phase ${state.phase}`);
    }
}

// The effect is already queued — staging and commitEffectFrame put it there. This
// promotes the player's choice out of the frame and makes it current.
//
// The guard is unreachable through the reducer, which validates first with the same
// helper, and is kept because this must not assume its only caller.
export function applyChooseNextEffect(state: GameState, action: Extract<GameAction, { type: "CHOOSE_NEXT_EFFECT" }>): GameState {
    const chosen = selectQueuedEffect(state, action.playerId, action.index, action.instanceId, action.effectId);
    if (typeof chosen === "string") throw new InvalidActionError(chosen);
    // Passes the object from the frame, not a copy — promoteEffect splices by identity.
    return promoteEffect(state, chosen);
}

export function applyChooseTarget(state: GameState, action: Extract<GameAction, { type: "CHOOSE_TARGET" }>): GameState {
    // add target to the current effect context selected
    state = pushSelectedTarget(state, action.instanceId);
    return state;
}