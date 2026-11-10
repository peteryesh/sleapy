
import type { GameState, PlayerId, SignalCause, CardInstanceId, DonInstance, StackPosition, Zone, PlayCause, Card, Phase, RemovalMethod } from "../../types";
import { moveCard, removeFromZone, getZoneArray, setActive, setRested, insertCardAtZoneIndex, setCardPlayedThisTurn, getCardInstance, setDecisionPoint } from "../mechanics";
import { setPhase } from "../mechanics/turn";
import { emit } from "../emitter";
import { InvalidActionError } from "../../errors";
import { donRest, donDetach } from './zones/don';
import { CHARACTERS_MAX, STAGE_MAX } from '../constants';
import { calculateCost } from '../calculations';
import { captureSnapshot } from '../snapshot';

// Set Active/Rested

/**
 * Sets a list of cards as active. It is the responsibility of the caller to collect the cards to be set as active.
 * @param state - Game state
 * @param playerId - Player that owns the cards that are being set as active
 * @param instanceIds - Ids of cards to set as active
 * @param signalCause - Reason to set cards as active
 * @return Game state with the specified cards set as active
 */
export function cardsSetActive(state: GameState, playerId: PlayerId, instanceIds: CardInstanceId[], signalCause: SignalCause): GameState {
    for (const instanceId of instanceIds) {
        const card = getCardInstance(state, instanceId);
        if (card.class === "DON") {
            throw new InvalidActionError(`Wrong function used to set DON!! as active`);
        } 
        if (!(card.class === "CHARACTER" || card.class === "LEADER" || card.class === "STAGE")) {
            throw new InvalidActionError(`${instanceId} is not a valid target to set active`);
        }
        state = setActive(state, instanceId);
    }
    return emit(state, { type: "CARDS_SET_ACTIVE", instanceIds: instanceIds, controller: playerId, cause: signalCause });
}

/**
 * Sets a list of cards as rested. It is the responsibility of the caller to collect the cards to be set as rested.
 * @param state - Game state
 * @param playerId - Player that owns the cards that are being set as rested
 * @param instanceIds - Ids of cards to set as rested
 * @param signalCause - Reason to set cards as rested
 * @return Game state with the specified cards set as rested
 */
export function cardsSetRested(state: GameState, playerId: PlayerId, instanceIds: CardInstanceId[], signalCause: SignalCause): GameState {
    for (const instanceId of instanceIds) {
        const card = getCardInstance(state, instanceId);
        if (card.class === "DON") {
            throw new InvalidActionError(`Wrong function used to set DON!! as rested`);
        } 
        if (!(card.class === "CHARACTER" || card.class === "LEADER" || card.class === "STAGE")) {
            throw new InvalidActionError(`${instanceId} is not a valid target to set rested`);
        }
        state = setRested(state, instanceId);
    }
    return emit(state, { type: "CARDS_RESTED", instanceIds: instanceIds, controller: playerId, cause: signalCause });
}

export function cardsRefresh(state: GameState, playerId: PlayerId): GameState {
    // STATUS EFFECT: frozen cards should not be refreshed, check here or in cardsSetActive
    const fieldCardIds = getZoneArray(state, playerId, "CHARACTERS").concat(getZoneArray(state, playerId, "LEADER")).concat(getZoneArray(state, playerId, "STAGE"));
    return cardsSetActive(state, playerId, fieldCardIds, { kind: "RULE" });
}


// Play Operations

/**
 * Plays a card, either from hand as a player action or from a zone by some effect. It is the responsibility of the caller to specify the play cause.
 * This function primarily used to play cards directly from hand due to the generic DON resting portion, but can play characters by effect as well.
 * @param state - Game state
 * @param playerId - Player that is playing the card
 * @param instanceId - Instance id of the card
 * @param signalCause - Cause of card being played
 * @return State with the card played to the appropriate zone
 */
export function playCard(state: GameState, playerId: PlayerId, instanceId: CardInstanceId, signalCause: PlayCause): GameState {
    const cardInstance = getCardInstance(state, instanceId);
    if (!(cardInstance.class === "CHARACTER" || cardInstance.class === "STAGE" || cardInstance.class === "EVENT")) {
        throw new InvalidActionError(`${instanceId} is not a playable instance`);
    }
    const cost = calculateCost(state, instanceId);

    // Card was played as a result of direct player action from hand
    // The right amount of DON must be rested by rule
    if (signalCause.kind === "PLAYER") {
        const activeDon = getZoneArray(state, playerId, "DON_ACTIVE");
        if (cardInstance.currentZone !== "HAND") throw new InvalidActionError(`${instanceId} cannot be played directly from ${cardInstance.currentZone}`);
        if (activeDon.length < cost) throw new InvalidActionError(`${instanceId} has a card cost greater than the amount of active DON`);
        state = donRest(state, playerId, cost, { kind: "RULE" });
    }

    // Set card as played this turn
    state = setCardPlayedThisTurn(state, instanceId);
    
    switch (cardInstance.class) {
        case "CHARACTER":
            return playCharacter(state, playerId, instanceId, signalCause);
        case "STAGE":
            return playStage(state, playerId, instanceId, signalCause);
        case "EVENT":
            return playEvent(state, playerId, instanceId, signalCause);
        default:
            throw new InvalidActionError(`${instanceId} not a playable card`);
    }
}

export function playCharacter(state: GameState, playerId: PlayerId, instanceId: CardInstanceId, signalCause: PlayCause): GameState {
    const characterZone = getZoneArray(state, playerId, "CHARACTERS");
    const character = getCardInstance(state, instanceId);
    const originZone = character.currentZone;
    if (character.class !== "CHARACTER") throw new InvalidActionError(`${instanceId} is not a character instance`);
    if (!originZone) throw new InvalidActionError(`${instanceId} does not have a current zone`);
    if (characterZone.length >= CHARACTERS_MAX) {
        return setDecisionPoint(state, { type: "DISPLACE_CARD", player: playerId, playedCardId: instanceId });    
    }
    // Captured in HAND, before the move. On-Play effects are unaffected: the
    // activeZone gate reads the listener's LIVE zone (CHARACTERS by emit time), not
    // the subject's captured one.
    const subject = captureSnapshot(state, instanceId);
    state = moveCard(state, instanceId, "CHARACTERS", "BOTTOM");
    return emit(state, { type: "CHARACTER_PLAYED", subjects: [subject], controller: playerId, fromZone: originZone, toZone: "CHARACTERS", cause: signalCause });
}

export function playStage(state: GameState, playerId: PlayerId, instanceId: CardInstanceId, signalCause: PlayCause): GameState {
    const stageZone = getZoneArray(state, playerId, "STAGE");
    const stage = getCardInstance(state, instanceId);
    const originZone = stage.currentZone;
    if (!originZone) throw new InvalidActionError(`${instanceId} does not have a current zone`);
    if (stage.class !== "STAGE") throw new InvalidActionError(`${instanceId} is not a stage instance`);
    if (stageZone.length >= STAGE_MAX) {
        return setDecisionPoint(state, { type: "DISPLACE_CARD", player: playerId, playedCardId: instanceId });
    }
    const subject = captureSnapshot(state, instanceId);
    state = moveCard(state, instanceId, "STAGE", "TOP");
    return emit(state, { type: "STAGE_PLAYED", subjects: [subject], controller: playerId, fromZone: originZone, toZone: "STAGE", cause: signalCause });
}

export function displaceCard(state: GameState, playerId: PlayerId, playedCardId: CardInstanceId, replacedId: CardInstanceId): GameState {
    const playedCard = getCardInstance(state, playedCardId);
    const replacedCard = getCardInstance(state, replacedId);
    if (!playedCard) throw new InvalidActionError(`No card instance found`);
    if (!replacedCard) throw new InvalidActionError(`No card instance found`);
    const playZoneName = replacedCard.currentZone;
    if (playZoneName !== "CHARACTERS" && playZoneName !== "STAGE") throw new InvalidActionError(`Zone is not able to handle replacement`);
    if (replacedCard.class !== "CHARACTER" && replacedCard.class !== "STAGE") throw new InvalidActionError(`Attempting to play ${playedCard.class}`);
    if (playedCard.class !== replacedCard.class) throw new InvalidActionError(`Played card is attempting to displace a card with a different card class`);
    if (replacedCard.class === "CHARACTER" && playZoneName !== "CHARACTERS") throw new InvalidActionError(`Card being replaced is a character not in the character zone`);
    if (replacedCard.class === "STAGE" && playZoneName !== "STAGE") throw new InvalidActionError(`Card being replaced is a stage not in the stage zone`);
    const zone = getZoneArray(state, playerId, playZoneName);
    if (playZoneName === "CHARACTERS" && zone.length < CHARACTERS_MAX) throw new InvalidActionError(`Attempting to replace character ${replacedId} while the character zone is not full`);
    if (playZoneName === "STAGE" && zone.length < STAGE_MAX) throw new InvalidActionError(`Attempting to replace stage ${replacedId} while the stage zone is not full`);
    const replaceIndex = zone.indexOf(replacedId);
    
    state = _removeCardFromField(state, playerId, replacedId, "DISPLACE", "TOP", { kind: "RULE" });

    const originZone = playedCard.currentZone;
    if (!originZone) throw new InvalidActionError(`${playedCardId} does not have a current zone`);
    const subject = captureSnapshot(state, playedCardId);
    state = removeFromZone(state, playedCardId);
    state = insertCardAtZoneIndex(state, playedCardId, playZoneName, replaceIndex);

    if (playZoneName === "CHARACTERS") {
        state = emit(state, { type: "CHARACTER_PLAYED", subjects: [subject], controller: playerId, fromZone: originZone, toZone: "CHARACTERS", cause: { kind: "PLAYER" } });
    }
    if (playZoneName === "STAGE") {
        state = emit(state, { type: "STAGE_PLAYED", subjects: [subject], controller: playerId, fromZone: originZone, toZone: "STAGE", cause: { kind: "PLAYER" } });
    }
    return state;
}

export function playEvent(state: GameState, playerId: PlayerId, instanceId: CardInstanceId, signalCause: PlayCause) {
    const event = getCardInstance(state, instanceId);
    if (event.class !== "EVENT") throw new InvalidActionError(`${instanceId} is not an event card instance`);
    
    const originZone = event.currentZone;
    if (!originZone) throw new InvalidActionError(`${instanceId} has no origin zone`);
    if (originZone === "TRASH") throw new InvalidActionError(`${instanceId} cannot be played from trash with playEvent function`);

    // One capture, two signals — both describe the same departure from hand, so they
    // report the same subject. Note the moveCard still comes FIRST: an event must be
    // in the trash before EVENT_PLAYED fires, or every "if you have N cards in your
    // trash" card is off by one. See the event-card section in CLAUDE.md.
    const subject = captureSnapshot(state, instanceId);
    state = moveCard(state, instanceId, "TRASH", "TOP");
    state = emit(state, { type: "CARDS_SENT_TO_TRASH", subjects: [subject], fromZone: originZone, controller: playerId, cause: signalCause });
    return emit(state, { type: "EVENT_PLAYED", subjects: [subject], controller: playerId, fromZone: originZone, toZone: "TRASH", cause: signalCause });
}


// Removal Operations

function _removeCardFromField(state: GameState, playerId: PlayerId, instanceId: CardInstanceId, method: RemovalMethod, position: StackPosition, signalCause: SignalCause ): GameState {
    const card = getCardInstance(state, instanceId);
    if (!(card.class === "CHARACTER" || card.class === "STAGE")) throw new InvalidActionError(`Only characters and stages can be removed from the field, but ${instanceId} is being removed`);
    
    const fromZone = card.currentZone;
    if (!fromZone) throw new InvalidActionError(`${instanceId} does not have a current zone`);
    if (!(fromZone === "CHARACTERS" || fromZone === "STAGE")) throw new InvalidActionError(`Cards can only be removed from the field from characters or stage, but ${instanceId} is being removed from ${fromZone}`);
    
    // Captured at the TOP, ahead of the DON detach — this is the fix for the loss
    // this function has always had. The detach strips the card's power buff before
    // anything downstream can read it, so a snapshot taken any later reports a card
    // that was never on the board in that state.
    //
    // One capture serves both this signal and the CARDS_SENT_TO_* below: they
    // describe the same departure from the field.
    const subject = captureSnapshot(state, instanceId);

    // Detach any attached DON before removing the card from the field
    if (card.attachedDon.length > 0) {
        state = donDetach(state, playerId, instanceId, card.attachedDon, { kind: "RULE" });
    }

    // NOTE: still emitted BEFORE the moveCard below. That ordering is what keeps
    // On-K.O. effects staging, because the activeZone gate reads the listener's live
    // zone. Normalising it to mutate-then-emit requires re-authoring On-K.O. effects
    // to activeZone: TRASH in the same change — see EFFECT_PLAN.md 6a.
    state = emit(state, { type: "CARD_REMOVED_FROM_FIELD", subjects: [subject], controller: playerId, removalMethod: method, cause: signalCause });
    
    switch (method) {
        case "KO":
            state = moveCard(state, instanceId, "TRASH", "TOP");
            return emit(state, { type: "CARDS_SENT_TO_TRASH", subjects: [subject], fromZone: fromZone, controller: playerId, cause: signalCause });
        case "TRASH_CARD":
            state = moveCard(state, instanceId, "TRASH", "TOP");
            return emit(state, { type: "CARDS_SENT_TO_TRASH", subjects: [subject], fromZone: fromZone, controller: playerId, cause: signalCause });
        case "BOUNCE_TO_HAND":
            state = moveCard(state, instanceId, "HAND", "TOP");
            return emit(state, { type: "CARDS_SENT_TO_HAND", subjects: [subject], fromZone: fromZone, controller: playerId, cause: signalCause });
        case "SEND_TO_DECK":
            state = moveCard(state, instanceId, "DECK", position);
            return emit(state, { type: "CARDS_SENT_TO_DECK", subjects: [subject], fromZone: fromZone, position: position, controller: playerId, cause: signalCause });
        case "SEND_TO_LIFE":
            state = moveCard(state, instanceId, "LIFE", position);
            return emit(state, { type: "CARDS_SENT_TO_LIFE", subjects: [subject], fromZone: fromZone, position: position, controller: playerId, cause: signalCause });
        case "DISPLACE":
            state = moveCard(state, instanceId, "TRASH", "TOP");
            return emit(state, { type: "CARDS_SENT_TO_TRASH", subjects: [subject], fromZone: fromZone, controller: playerId, cause: { kind: "RULE" } });
        default:
            throw new InvalidActionError(`Invalid removal method ${method}`);
    }
}

export function removeCardsFromField(state: GameState, playerId: PlayerId, instanceIds: CardInstanceId[], method: RemovalMethod, position: StackPosition, signalCause: SignalCause): GameState {
    if (instanceIds.length === 0) return state;
    
    for (const id of instanceIds) {
        state = _removeCardFromField(state, playerId, id, method, position, signalCause);
    }
    return state;
}

