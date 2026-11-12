import { produce } from "immer";
import type { GameConfig, GameSeeds, GameState, PlayerZones } from "../types/state";
import type { CardDef, DeckList } from "../types/card";
import type { EffectFrame } from "../types/effect";
import type { CardId, PlayerId } from "../types/primitives";
import { instantiatePlayerBoard } from "./instantiation";
import { nextInt } from "../rng/rng";
import { generateGameSeeds } from "../rng/seeds";

const STATE_VERSION = 1;

export function initGame(params: {
    gameId: string;
    playerIds: PlayerId[];
    defs: Record<CardId, CardDef>;
    decks: Record<PlayerId, DeckList>;
    seeds?: GameSeeds
}): GameState {
    const { gameId, playerIds, defs, decks, seeds } = params;

    const config = {
        gameId: gameId,
        playerIds: playerIds,
        seeds: seeds ?? generateGameSeeds(playerIds)
    } as GameConfig;

    let state = createEmptyGameState(config);

    state = produce(state, draft => {
        Object.assign(draft.definitions, defs);
    });

    for (const playerId of playerIds) {
        state = instantiatePlayerBoard(state, decks[playerId], defs, playerId);
    }

    return state;
}

export function createEmptyGameState(config: GameConfig): GameState {
    // Coin flip uses game seed at cursor 0 — deterministic and reproducible from the seed
    const playerIds = config.playerIds;

    const [postFlipCursor, flipIdx] = nextInt(config.seeds.game, 0n, playerIds.length);
    const coinFlipWinner = playerIds[flipIdx];

    return {
        version: STATE_VERSION,

        config: config,
        rngCursors: {
            game: postFlipCursor,
            players: Object.fromEntries(playerIds.map(id => [id, 0n]))
        },

        setup: {
            coinFlipWinner,
            firstPlayer: null,
            mulligan: Object.fromEntries(playerIds.map(id => [id, "PENDING"]))
        },

        definitions: {},
        instances: {},

        playerZones: emptyPlayerZones(playerIds),

        turnOrder: playerIds,
        turn: 0,
        turnPlayerId: coinFlipWinner,
        phase: "SETUP",
        cardsPlayedThisTurn: [],
        effectsUsedThisTurn: [],

        currentBattle: null,
        battlesThisTurn: [],

        decisionPoint: { type: "SELECT_FIRST_PLAYER", player: coinFlipWinner},

        currentEffect: null,
        effectQueue: [],
        stagingFrame: emptyEffectFrame(playerIds),

        statusEffects: [],

        gameLog: [],

        winner: null,
        endReason: null
    };
}

export function emptyPlayerZones(playerIds: PlayerId[]): Record<PlayerId, PlayerZones> {
    const zones: Record<PlayerId, PlayerZones> = {} as Record<PlayerId, PlayerZones>;
    for (const id of playerIds) {
        zones[id] = {
            characters: [],
            deck: [],
            donActive: [],
            donDeck: [],
            donRested: [],
            hand: [],
            leader: [],
            life: [],
            look: [],
            stage: [],
            trash: [],
            trigger: [],
        };
    }
    return zones;
}

export function emptyEffectFrame(playerIds: PlayerId[]): EffectFrame {
    return Object.fromEntries(playerIds.map(id => [id, []]));
}