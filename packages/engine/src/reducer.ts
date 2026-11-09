import { produce } from 'immer';
import type { GameState } from './types/state';
import type { GameAction } from './types/action';
import { validate } from './validator';
import { InvalidActionError, assertNever } from './errors';
import { 
    applyActivateEffect,
    applyPlayCard,
    applyAttachDon,
    applyDeclareAttack,
    applyDeclareBlocker,
    applyPlayCounter,
    applyCompleteBattle,
    applyNextPhase,
    applyTriggerActivation,
    applyDisplaceCardOnField,
    applyChooseNextEffect,
    applyChooseTarget
} from './game/actions/main';
import { applyChooseFirstPlayer, applyKeepHand, applyMulligan, setPlayerLife, shuffleDeck } from './game/actions/start';
import { getCardInstance, removeDecisionPoint, setDecisionPoint, setGameEnd } from './game/mechanics';
import { enterStartGamePhase, cardsDraw, enterStartOfTurnPhase, setStartTurnState, enterRefreshPhase, enterDrawPhase, enterMainPhase, enterOnOpponentAttackPhase, enterBlockerPhase, enterCounterPhase, enterBattleResolutionPhase, enterWhenAttackingPhase } from './game/operations';
import { OPENING_HAND_SIZE } from './game/constants';
import type { Phase } from './types';
import { advance } from './conductor';

export { InvalidActionError } from './errors';

export function reducer(state: GameState, action: GameAction): GameState {
    if (state.winner !== null) {
        throw new InvalidActionError('Game is already finished');
    }

    const error = validate(state, action);
    if (error) throw new InvalidActionError(error);

    state = produce(state, draft => {
        draft.gameLog.push({ kind: "ACTION", action });
    });

    switch (action.type) {
        case 'CHOOSE_FIRST_PLAYER':
            state = applyChooseFirstPlayer(state, action);
            break;
        case 'KEEP_HAND':
            state = applyKeepHand(state, action);
            break;
        case 'MULLIGAN':
            state = applyMulligan(state, action);
            break;
        case 'PLAY_CARD':
            state = applyPlayCard(state, action);
            break;
        case 'DISPLACE_ON_FIELD':
            state = applyDisplaceCardOnField(state, action);
            break;
        case 'ATTACH_DON':
            state = applyAttachDon(state, action);
            break;
        case 'DECLARE_ATTACK':
            state = applyDeclareAttack(state, action);
            break;
        case 'DECLARE_BLOCKER':
            state = applyDeclareBlocker(state, action);
            break;
        case 'PLAY_COUNTER':
            state = applyPlayCounter(state, action);
            break;
        case 'COMPLETE_BATTLE':
            state = applyCompleteBattle(state, action);
            break;
        case 'ACTIVATE_TRIGGER':
            state = applyTriggerActivation(state, action);
            break;
        case 'ACTIVATE_EFFECT':
            state = applyActivateEffect(state, action);
            break;
        case 'NEXT_PHASE':
            state = applyNextPhase(state, action);
            break;
        case 'CHOOSE_NEXT_EFFECT':
            state = applyChooseNextEffect(state, action);
            break;
        case 'CHOOSE_TARGET':
            state = applyChooseTarget(state, action);
            break;
        case 'SUBMIT_REORDER':
            throw new InvalidActionError(`${action.type} is not yet implemented`);
        default:
            return assertNever(action);
    }
    state = removeDecisionPoint(state); // Action consumes decision point
    return advance(state); // Advance state until next decision point
}