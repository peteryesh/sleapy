// game/instances.ts

import { produce } from "immer";
import type {
    PlayerId,
    CardId,
    CardInstanceId,
    CardClass,
} from "../types/primitives";
import type { GameState } from "../types/state";
import type {
    DeckList,
    CardInstance,
    LeaderInstance,
    CharacterInstance,
    StageInstance,
    DonInstance,
    CardDef,
    EventInstance
} from "../types/card";
import type { Zone } from "../types/primitives";

export function instantiatePlayerBoard(state: GameState, deckList: DeckList, defs: Record<CardId, CardDef>, controller: PlayerId): GameState {
    const { leader, deck, sideDeck, donCount } = deckList;

    // Instantiate leader
    state = instantiateLeader(state, leader, defs, controller);

    // Instantiate deck cards
    state = instantiateDeck(state, deck, defs, controller);

    // Instantiate DON!! cards
    state = instantiateDon(state, donCount, controller);

    return state;
}

export function instantiateLeader(state: GameState, cardId: CardId, defs: Record<CardId, CardDef>, controller: PlayerId): GameState {
    const instanceId = `${controller}-LEADER` as CardInstanceId;
    const leaderInstance = createInstance(instanceId, "LEADER", controller, defs[cardId], "LEADER") as LeaderInstance;

    return produce(state, draft => {
        draft.instances[instanceId] = leaderInstance;
        draft.playerZones[controller].leader.push(instanceId);
    });
}

export function instantiateDeck(state: GameState, cardIds: CardId[], defs: Record<CardId, CardDef>, controller: PlayerId): GameState {
    const newInstances: Record<CardInstanceId, CardInstance> = {};
    cardIds.forEach((cardId, index) => {
        const instanceId = `${controller}-CARD-${index}` as CardInstanceId; // unique instance ID
        newInstances[instanceId] = createInstance(instanceId, defs[cardId].class, controller, defs[cardId], "DECK");
    });

    return produce(state, draft => {
        Object.assign(draft.instances, newInstances);
        draft.playerZones[controller].deck.push(...Object.keys(newInstances) as CardInstanceId[]);
    });
}

export function instantiateDon(state: GameState, donCount: number, controller: PlayerId): GameState {
    const newInstances: Record<CardInstanceId, CardInstance> = {};
    for (let i = 0; i < donCount; i++) {
        const instanceId = `${controller}-DON-${i}` as CardInstanceId; // unique instance ID
        newInstances[instanceId] = createInstance(instanceId, "DON", controller, undefined, "DON_DECK");
    }

    return produce(state, draft => {
        Object.assign(draft.instances, newInstances);
        draft.playerZones[controller].donDeck.push(...Object.keys(newInstances) as CardInstanceId[]);
    });
}

export function createInstance(instanceId: CardInstanceId, cardClass: CardClass, controller: PlayerId, cardDef?: CardDef, initialZone: Zone | null = null): CardInstance {
    // Only DON instances exist without a definition. Anything else with no cardId
    // is unusable downstream, so fail here rather than at the first lookup.
    if (cardClass !== "DON" && !cardDef) {
        throw new Error(`Cannot create a ${cardClass} instance ${instanceId} without a card definition`);
    }
    const baseInstance = {
        instanceId,
        controller,
        currentZone: initialZone,
        isRested: false
    };
    switch (cardClass) {
        case "LEADER":
            return {
                ...baseInstance,
                cardId: cardDef!.id,
                class: "LEADER",
                attachedDon: [],
            } as LeaderInstance;
        case "CHARACTER":
            return {
                ...baseInstance,
                cardId: cardDef!.id,
                class: "CHARACTER",
                attachedDon: [],
                playedOnTurns: [],
                flipped: false
            } as CharacterInstance;
        case "STAGE":
            return {
                ...baseInstance,
                cardId: cardDef!.id,
                class: "STAGE",
                attachedDon: [],
                playedOnTurns: [],
                flipped: false
            } as StageInstance;
        case "EVENT":
            return {
                ...baseInstance,
                cardId: cardDef!.id,
                class: "EVENT",
                playedOnTurns: [],
                flipped: false
            } as EventInstance;
        case "DON":
            return {
                ...baseInstance,
                class: "DON",
                isRested: false,
                attachedTo: null,
                donValue: 1000
            } as DonInstance;
        default:
            throw new Error(`Unknown card class ${cardClass} for instance ${instanceId}`);
    }
}