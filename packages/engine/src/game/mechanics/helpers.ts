import type { GameState, PlayerId, Zone, CardInstance, CardInstanceId, CardDef } from "../../types";

/**
 * Helper function to get the zone array for the provided player
 * @param state - Current game state
 * @param playerId - Player id that we want the zone of
 * @param zone - Zone for the player that we want, nullable due to the currentZone being able to provide a null value, though no null zone value should be expected or provided
 * @returns Game state with the card instance id removed from the instance's current zone, and the instance's current zone set to null
 */
export function getZoneArray(state: GameState, playerId: PlayerId, zone: Zone | null): CardInstanceId[] {
    const playerZones = state.playerZones[playerId];
    if (!playerZones) {
        throw new Error(`Unknown playerId ${playerId}`);
    }
    switch (zone) {
        case "CHARACTERS":  return playerZones.characters;
        case "DECK":        return playerZones.deck;
        case "DON_ACTIVE":  return playerZones.donActive;
        case "DON_DECK":    return playerZones.donDeck;
        case "DON_RESTED":  return playerZones.donRested;
        case "HAND":        return playerZones.hand;
        case "LEADER":      return playerZones.leader;
        case "LIFE":        return playerZones.life;
        case "LOOK":        return playerZones.look;
        case "STAGE":       return playerZones.stage;
        case "TRASH":       return playerZones.trash;
        case "TRIGGER":     return playerZones.trigger;
        case null:          throw new Error(`Null zone provided, no zone to return`);
        default:            throw new Error(`Provided zone was not an accepted zone value`);
    }
}

export function getCardInstance(state: GameState, instanceId: CardInstanceId): CardInstance {
    const card = state.instances[instanceId];
    if (!card) throw new Error(`Card instance ${instanceId} not found`);
    return card;
}

export function getCardDef(state: GameState, instanceId: CardInstanceId): CardDef {
    const card = getCardInstance(state, instanceId);
    if (card.class === "DON") throw new Error(`Cannot get DON card definition`);
    const cardDef = state.definitions[card.cardId];
    if (!cardDef) throw new Error(`Card definition for instance ${instanceId} not found`);
    return cardDef;
}

export function getPlayersInTurnOrder(state: GameState): PlayerId[] {
    const ids = state.config.playerIds;
    const start = ids.indexOf(state.turnPlayerId);
    if (start === -1) throw new Error(`Turn player ${state.turnPlayerId} not in playerIds`);
    return [...ids.slice(start), ...ids.slice(0, start)];
}