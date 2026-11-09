import { GameState, GameAction, DecisionPoint } from "./types";
import { calculateCost, calculateCounter } from "./game/calculations";
import { CardInstanceId } from "./types";
import { getCardInstance, getZoneArray, selectQueuedEffect } from "./game/mechanics";
import { CHARACTERS_MAX, STAGE_MAX } from "./game/constants";
import { evalContextOf, isValidSelection } from "./game/effects";

const validActions: {[T in DecisionPoint['type']]: GameAction['type'][]} = {
    SELECT_FIRST_PLAYER: ["CHOOSE_FIRST_PLAYER"],
    MULLIGAN: ["KEEP_HAND", "MULLIGAN"],
    START_TURN: ["NEXT_PHASE"],
    MAIN_ACTION: ["NEXT_PHASE", "PLAY_CARD", "ATTACH_DON", "DECLARE_ATTACK", "ACTIVATE_EFFECT"],
    DISPLACE_CARD: ["DISPLACE_ON_FIELD"],
    BLOCKER_SELECTION: ["NEXT_PHASE", "DECLARE_BLOCKER"],
    COUNTER_STEP: ["PLAY_COUNTER", "COMPLETE_BATTLE"],
    TRIGGER: ["ACTIVATE_TRIGGER"],
    REORDER: ["SUBMIT_REORDER"],
    RESOLVE_EFFECT_ORDER: ["CHOOSE_NEXT_EFFECT"],
    EFFECT_TARGET: ["CHOOSE_TARGET"],
}

function actionFitsDecision(state: GameState, action: GameAction): boolean {
    return validActions[state.decisionPoint!.type].includes(action.type);
}

export function validate(state: GameState, action: GameAction): string | null {
    if (!actionFitsDecision(state, action)) return `${state.decisionPoint!.type} not compatible with action type ${action.type}`;
    
    // Mulligan is special because it is the only action in the game that does not rely on order
    if (state.decisionPoint?.type === "MULLIGAN" ) {
        if ((action.type === "KEEP_HAND" || action.type === "MULLIGAN") && state.setup.mulligan[action.playerId] !== "PENDING") {
            return `Can only call mulligan or keep hand when mulligan decision is pending`;
        }
        return null;
    }

    if (state.decisionPoint?.player !== action.playerId) return `${action.playerId} is not the acting player`;
    
    switch (action.type) {
        case "CHOOSE_FIRST_PLAYER":
            // Deciding player is the coinFlipWinner
            if (action.playerId !== state.setup.coinFlipWinner) return `Only the coin flip winner can choose the first player`;
            // Choice is a player that exists
            if (!state.turnOrder.includes(action.choice)) return `Chosen first player ${action.choice} is not in the game`;
            break;
        case "NEXT_PHASE":
            // Pass if blocker step
            if (state.phase === "BLOCKER") break;
            // Player's on opponent's attack pending effects are optional and can pass
            //      NOT IMPLEMENTED
            // Pass if phase is start of turn or main (end turn)
            if (state.phase !== "START_OF_TURN" && state.phase !== "MAIN") return `Cannot end phase from phase ${state.phase}`;
            break;
        case "PLAY_CARD":
            // Card belongs to the player
            const card = getCardInstance(state, action.instanceId);
            if (card.controller !== action.playerId) return `Player ${action.playerId} cannot play card they do not own`;
            // Card is in the HAND zone
            if (card.currentZone !== "HAND") return `Player ${action.playerId} cannot play card that is not in their hand`;
            // Card is not a DON or a LEADER
            if (card.class === "DON" || card.class === "LEADER") return `Player ${action.playerId} cannot play card of class ${card.class}`;
            // Card has enough DON to be played
            if (state.playerZones[action.playerId].donActive.length < calculateCost(state, action.instanceId)) return `Player ${action.playerId} does not have enough DON to play this card`;
            break;
        case "DISPLACE_ON_FIELD": {
            // Decision point has played card id context
            if (state.decisionPoint.type !== "DISPLACE_CARD") return `Decision point is not the right type: ${state.decisionPoint.type}`;            
            // Action displaced card has the same type as played card id
            const playedCard = getCardInstance(state, state.decisionPoint.playedCardId);
            const displacedCard = getCardInstance(state, action.displacedId);
            if (playedCard.controller !== action.playerId || displacedCard.controller !== action.playerId) return `Cards do not belong to the player performing displacement`;
            if (playedCard.class !== displacedCard.class) return `Played card ${state.decisionPoint.playedCardId} with class ${playedCard.class} does not match ${displacedCard.class}`;
            // If displaced card is in character zone, character zone is full
            if (playedCard.class === "CHARACTER" && state.playerZones[action.playerId].characters.length < CHARACTERS_MAX) {
                return `Attempting to replace at non-full character zone`;
            }
            // If displaced card is in stage zone, stage zone is full
            if (playedCard.class === "STAGE" && state.playerZones[action.playerId].stage.length < STAGE_MAX) {
                return `Attempting to replace at non-full stage zone`;
            }
        }
            break;
        case "ATTACH_DON":
            // Count is greater than 0
            if (action.count <= 0) return `No DON given to attach`;
            // Count is not greater than the amount of active DON
            if (state.playerZones[action.playerId].donActive.length < action.count) return `${action.playerId} is attempting to attach more DON than they have active`;
            // Target is controlled by the player
            const target = getCardInstance(state, action.targetId);
            if (target.controller !== action.playerId) return `Attempting to attach an active DON to a target that the active player does not control`;
            // Target is a CHARACTER or a LEADER
            if (target.class !== "CHARACTER" && target.class !== "LEADER") return `${action.targetId} is of class ${target.class} and cannot have DON attached to it`; 
            // All DON belong to the player and are from the DON_ACTIVE zone
            for (const donId of getZoneArray(state, action.playerId, "DON_ACTIVE").slice(0, action.count)) {
                const don = getCardInstance(state, donId);
                if (!(don.controller === action.playerId)) return `${donId} not controlled by the active player`;
                if (!(don.currentZone === "DON_ACTIVE")) return `Attempting to actively attach a non-active DON`;
            }
            // Cannot attach don effects are not active
            break;
        case "DECLARE_ATTACK":
            // It is not the player's first turn of the game
            if (state.turn <= state.turnOrder.length) return `According to the game rules, it is illegal for attacks on the player's first turn`;
            const attacker = getCardInstance(state, action.attackerId);
            // Attacker is a CHARACTER or LEADER
            if (attacker.class !== "CHARACTER" && attacker.class !== "LEADER") return `${action.attackerId} cannot declare attack or engage in battle`;
            // Attacker is in the CHARACTERS or LEADER zone
            if (attacker.currentZone !== "CHARACTERS" && attacker.currentZone !== "LEADER") return `${action.attackerId} cannot declare attack from zone ${attacker.currentZone}`;
            // Attacker belongs to the turn player
            if (attacker.controller !== action.playerId) return `${action.attackerId} is not controlled by the active player`;
            // Attacker is not rested
            if (attacker.isRested) return `${action.attackerId} is rested and cannot attack`;
            // Attacker was not played this turn or attacker has rush
            const playedThisTurn = state.cardsPlayedThisTurn.includes(action.attackerId);
            if (playedThisTurn) {
                // Attacker does not have rush or does not have character rush, return
                return `${action.attackerId} was played this turn and cannot attack`;
            }
            // Cleared to attack legal targets
            const defender = getCardInstance(state, action.defenderId);
            // Defender does not belong to the turn player
            if (defender.controller === action.playerId) return `${action.defenderId} cannot be controlled by the turn player`;
            // Defender is a CHARACTER and rested or attacker has attack active
            if (defender.class === "CHARACTER" && !defender.isRested /** && attacker does not have attack active */) return `${action.defenderId} is not rested and ${action.attackerId} does not have attack active`;
            
            // Defender is a LEADER
            if (defender.class !== "CHARACTER" && defender.class !== "LEADER") return `${action.defenderId} is not a valid attack target`;
            // Defender is in the CHARACTERS or LEADER zone
            if (defender.currentZone !== "CHARACTERS" && defender.currentZone !== "LEADER") return `${action.defenderId} cannot have an attack declared against it while in zone ${defender.currentZone}`;
            break;
        case "DECLARE_BLOCKER":
            // A battle exists
            if (state.currentBattle === null) return `There is no battle to consider for blocker`;
            const currentDefender = getCardInstance(state, state.currentBattle.defenderId);
            // Current defender belongs to the player
            if (currentDefender.controller !== action.playerId) return `${action.playerId} is not the actively defending player`;
            const blocker = getCardInstance(state, action.blockerId);
            // Blocker is controlled by the previous defender
            if (currentDefender.controller !== blocker.controller) return `${action.blockerId} controlled by a different player than the original defender`;
            // Blocker is a CHARACTER or a LEADER
            if (blocker.class !== "CHARACTER" && blocker.class !== "LEADER") return `${action.blockerId} cannot have the blocker keyword`;
            // Blocker is in the CHARACTERS or LEADER zone
            if (blocker.class === "LEADER" && blocker.currentZone !== "LEADER") return `${action.blockerId} is a leader but is not in the leader zone`;
            if (blocker.class === "CHARACTER" && blocker.currentZone !== "CHARACTERS") return `${action.blockerId} cannot be declared a blocker from zone ${blocker.currentZone}`;
            // Blocker is not rested
            if (blocker.isRested) return `${action.blockerId} is rested and cannot block`;
            // Blocker has the [Blocker] keyword NOT IMPLEMENTED
            return "Blocker not implemented";
            break;
        case "PLAY_COUNTER":
            // A battle exists
            if (state.currentBattle === null) return `No active battle to play counter for`;
            const counterCard = getCardInstance(state, action.counterId);
            // Counter card is owned by the player
            if (counterCard.controller !== action.playerId) return `${action.playerId} does not control ${action.counterId} that was played for counter`;
            // Counter card is in the HAND zone
            if (counterCard.currentZone !== "HAND") return `Cannot counter from zone ${counterCard.currentZone}`;
            // Counter card is an EVENT and has a counter effect
            if (counterCard.class === "EVENT" /** && does not have a counter effect */) return `${action.counterId} is an event and has no counter effect`;
            // Counter card is a CHARACTER and has a counter value
            if (counterCard.class === "CHARACTER" && calculateCounter(state, action.counterId) <= 0) return `${action.counterId} has no counter value and cannot be used to counter`;
            // Counter card is a CHARACTER
            if (counterCard.class !== "CHARACTER") return `${action.counterId} cannot be played for counter`;
            break;
        case "COMPLETE_BATTLE":
            // A battle exists
            if (state.currentBattle === null) return `No active battle to resolve`;
            break;
        case "ACTIVATE_TRIGGER":
            // if activation is true and the card does not have a trigger ability, return
            if (action.activate /** && trigger effect does not exist */) return `${action.instanceId} does not have a trigger ability`;
            break;
        case "SUBMIT_REORDER": {
            const idCounts = new Map<CardInstanceId, number>();
            for (const id of state.playerZones[action.playerId].look) {
                idCounts.set(id, (idCounts.get(id) || 0) + 1);
            }
            for (const id of action.orderedInstanceIds) {
                const count = idCounts.get(id);
                if (count === 1) {
                    idCounts.delete(id);
                }
                else {
                    idCounts.set(id, count! - 1);
                }
            }
            if (idCounts.size !== 0) return `Reordered list of ids was not a valid permutation`;
            break;
        }
        case "ACTIVATE_EFFECT":
            return "Not yet implemented";
        case "CHOOSE_NEXT_EFFECT": {
            // Same helper the apply uses, so an action that validates cannot then fail
            // to apply — the two error paths are one implementation.
            const chosen = selectQueuedEffect(state, action.playerId, action.index, action.instanceId, action.effectId);
            if (typeof chosen === "string") return chosen;
            break;
        }
        case "CHOOSE_TARGET": {
            // get effect eval context from the state
            if (state.currentEffect === null) return `No current effect context to choose target for`;
            const currentEffectStep = state.currentEffect.steps[state.currentEffect.cursor];
            if (currentEffectStep.kind !== "PAYMENT" && currentEffectStep.kind !== "RESOLUTION") {
                return `CHOOSE_TARGET can only be performed on effect steps with operations`;
            }
            if (!("target" in currentEffectStep.operation)) {
                return `No target expression in operation`;
            }
            if (currentEffectStep.operation.target === null || currentEffectStep.operation.target === undefined) {
                return `No target definition in operation`;
            }
            if (currentEffectStep.operation.target.kind !== "PLAYER_CHOICE_TARGET") {
                return `Requires PLAYER_CHOICE_TARGET to choose targets`;
            }
            const decisionPoint = state.decisionPoint;
            if (decisionPoint.type !== "EFFECT_TARGET") {
                return `Requires EFFECT_TARGET decision point type`;
            }
            if (!isValidSelection(state, evalContextOf(state.currentEffect), decisionPoint.constraint, action.instanceId)) {
                return `Invalid target selected for effect`;
            }
            
            break;
        }
    }
    return null;
}