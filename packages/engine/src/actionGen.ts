// actionGen.ts
import { CHARACTERS_MAX, STAGE_MAX } from './game/constants';
import { getZoneArray } from './game/mechanics';
import { DecisionPoint, GameState, GameAction, PlayerId } from './types';
import { evalTargetExpression } from './evaluator';
import { validate } from './validator';
import { evalContextOf } from './game/effects';

export type ActionGenerator = (state: GameState, dp: DecisionPoint, out: GameAction[]) => void;

export function getLegalActions(state: GameState, requestingPlayer: PlayerId): GameAction[] {
    if (state.winner !== null) return [];
    const candidates: GameAction[] = [];
    let dp = state.decisionPoint;
    if (!dp) return [];
    if (dp.type === "MULLIGAN") {
        dp = { type: "MULLIGAN", player: requestingPlayer };
    }
    if (dp.player !== requestingPlayer) return [];
    actionGeneratorRouter[dp.type].flatMap(gen => gen(state, dp, candidates));
    return candidates.filter(a => validate(state, a) === null);
}

const genFirstPlayer: ActionGenerator = (state, dp, out) => {
    out.push(...state.turnOrder.map(choice => ({
        type: "CHOOSE_FIRST_PLAYER" as const,
        playerId: dp.player,
        choice,
    })));
}

const genMulligan: ActionGenerator = (state, dp, out) => {
    out.push(
        { type: "KEEP_HAND" as const, playerId: dp.player },
        { type: "MULLIGAN" as const, playerId: dp.player },
    );
}

const genPlayCard: ActionGenerator = (state, dp, out) => {
    const zones = state.playerZones[dp.player];
    for (const instanceId of zones.hand) {
        out.push({ type: "PLAY_CARD", playerId: dp.player, instanceId });
    }
}

const genAttachDon: ActionGenerator = (state, dp, out) => {
    const zones = state.playerZones[dp.player];
    if (zones.donActive.length === 0) return;
    const targets = [...zones.characters, ...zones.leader];
    for (const targetId of targets) {
        for (let i = 0; i < zones.donActive.length; i++) {
            out.push({
                type: "ATTACH_DON",
                playerId: dp.player,
                targetId,
                count: i + 1
            });
        }
    }
}

const genNextPhase: ActionGenerator = (state, dp, out) => {
    out.push({ type: "NEXT_PHASE", playerId: dp.player });
}

const genDeclareAttack: ActionGenerator = (state, dp, out) => {
    const zones = state.playerZones[dp.player];
    const attackers = [...zones.characters, ...zones.leader];
    const opponents = state.turnOrder.filter(id => id !== dp.player);
    for (const opponentId of opponents) {
        const oppZones = state.playerZones[opponentId];
        const defenders = [...oppZones.characters, ...oppZones.leader];
        for (const attackerId of attackers) {
            for (const defenderId of defenders) {
                out.push({ type: "DECLARE_ATTACK", playerId: dp.player, attackerId, defenderId });
            }
        }
    }
}

const genDeclareBlocker: ActionGenerator = (state, dp, out) => {
    // find all available blockers
}

const genPlayCounter: ActionGenerator = (state, dp, out) => {
    const zones = state.playerZones[dp.player];
    for (const counterId of zones.hand) {
        out.push({ type: "PLAY_COUNTER", playerId: dp.player, counterId });
    }
}

const genCompleteBattle: ActionGenerator = (state, dp, out) => {
    out.push({ type: "COMPLETE_BATTLE", playerId: dp.player })
}

const genActivateEffect: ActionGenerator = (state, dp, out) => {
    // check for effects that can be activated
}

// Offer every effect the player has waiting in the CURRENT frame — never the next
// one. A frame is "everything that activated at the same time", so frame N must drain
// completely before frame N+1 is choosable.
//
// Two entries can look identical (same card, same effect, staged off two signals) and
// still resolve differently, because they carry different subjects. `index` is what
// makes the second one reachable.
const genChooseNextEffect: ActionGenerator = (state, dp, out) => {
    const frame = state.effectQueue[0]?.[dp.player] ?? [];
    frame.forEach((effect, index) => {
        out.push({
            type: "CHOOSE_NEXT_EFFECT",
            playerId: dp.player,
            index,
            instanceId: effect.instanceId,
            effectId: effect.effectId,
        });
    });
}

const genChooseTargets: ActionGenerator = (state, dp, out) => {
    // find valid targets
    if (dp.type !== "EFFECT_TARGET") return;
    const targets = evalTargetExpression(state, evalContextOf(state.currentEffect!), dp.constraint);
    for (const targetId of targets) {
        out.push({
            type: "CHOOSE_TARGET",
            playerId: dp.player,
            instanceId: targetId
        });
    }
}

const genTriggerActivation: ActionGenerator = (state, dp, out) => {
    // check for trigger, option activate trigger
    // option no trigger
    if (state.playerZones[dp.player].trigger.length === 0) return;
    out.push({ type: "ACTIVATE_TRIGGER", playerId: dp.player, instanceId: state.playerZones[dp.player].trigger[0], activate: true });
    out.push({ type: "ACTIVATE_TRIGGER", playerId: dp.player, instanceId: state.playerZones[dp.player].trigger[0], activate: false });
}

// We don't have the played card context, rely on the playCard operation to set the played card id in the decision point
// All possible replacements are generated because of lack of card context
// The displacement apply function should read the decision point context, then combine with the action to know which card to displace
const genChooseDisplaceCard: ActionGenerator = (state, dp, out) => {
    const charZone = getZoneArray(state, dp.player, "CHARACTERS");
    const stageZone = getZoneArray(state, dp.player, "STAGE");
    if (charZone.length >= CHARACTERS_MAX) {
        // generate all characters as replacements
        for (const charId of charZone) {
            out.push({ type: "DISPLACE_ON_FIELD", playerId: dp.player, displacedId: charId });
        }
    }
    if (stageZone.length >= STAGE_MAX) {
        out.push({ type: "DISPLACE_ON_FIELD", playerId: dp.player, displacedId: stageZone[0] });
    }
}

const genChooseReorder: ActionGenerator = (state, dp, out) => {
    out.push({
        type: "SUBMIT_REORDER",
        playerId: dp.player,
        orderedInstanceIds: [...state.playerZones[dp.player].look]
    });
}

const actionGeneratorRouter: Record<DecisionPoint['type'], ActionGenerator[]> = {
    SELECT_FIRST_PLAYER: [genFirstPlayer],
    MULLIGAN: [genMulligan],
    START_TURN: [genNextPhase],
    MAIN_ACTION: [genPlayCard, genAttachDon, genActivateEffect, genDeclareAttack, genNextPhase],
    DISPLACE_CARD: [genChooseDisplaceCard],
    BLOCKER_SELECTION: [genDeclareBlocker, genNextPhase],
    COUNTER_STEP: [genPlayCounter, genCompleteBattle],
    TRIGGER: [genTriggerActivation],
    REORDER: [genChooseReorder],
    RESOLVE_EFFECT_ORDER: [genChooseNextEffect],
    EFFECT_TARGET: [genChooseTargets],
};