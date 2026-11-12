import type { CardInstanceId, PlayerId, Phase, EndReason, CardId, BattleRecord, MulliganChoice } from './primitives';
import type { CardDef, CardInstance } from './card';
import type { Seed } from '../rng/seeds';
import { EffectFrame, StatusEffectDef, EffectContext } from './effect';
import type { EffectId } from './effect';
import { LogEntry } from './record';
import { TargetExpression } from './expression';

// One consumed [Once Per Turn] use: this effect, on this card instance.
export type UsedEffect = { instanceId: CardInstanceId; effectId: EffectId };

export type DecisionPoint =
    | { type: 'SELECT_FIRST_PLAYER'; player: PlayerId; }
    | { type: 'MULLIGAN'; player: PlayerId; }
    | { type: 'START_TURN'; player: PlayerId; }
    | { type: 'MAIN_ACTION'; player: PlayerId; }
    | { type: 'DISPLACE_CARD'; player: PlayerId; playedCardId: CardInstanceId; }
    | { type: 'BLOCKER_SELECTION'; player: PlayerId; battle: BattleRecord; }
    | { type: 'COUNTER_STEP'; player: PlayerId; battle: BattleRecord; }
    | { type: 'TRIGGER'; player: PlayerId; }
    | { type: 'REORDER'; player: PlayerId }
    | { type: 'RESOLVE_EFFECT_ORDER'; player: PlayerId; }
    | { type: 'EFFECT_TARGET'; player: PlayerId; constraint: TargetExpression }

// RNG Cursors
type RngCursors = {
    game: bigint;
    players: Record<PlayerId, bigint>;
};

export type GameSeeds = {
    game: Seed;
    players: Record<PlayerId, Seed>;
};

export type GameConfig = {
    gameId: string;
    playerIds: PlayerId[];
    seeds: GameSeeds;

    // teamConfig: TeamConfig;
    // winCondition: WinCondition;
};

// type TeamConfig =
//     | { kind: "FREE_FOR_ALL" }                    // every player for themselves
//     | { kind: "TEAMS"; teams: PlayerId[][] };      // e.g. [["p1","p3"], ["p2","p4"]]

// type WinCondition =
//     | { kind: "LAST_STANDING" }                   // last player with life wins
//     | { kind: "TEAM" }                            // team-based, derived from TeamConfig


export type SetupState = {
    coinFlipWinner: PlayerId; // player who gets to call CHOOSE_TURN_ORDER
    firstPlayer: PlayerId | null;
    mulligan: Record<PlayerId, MulliganChoice>;
};

///----------------------------------------------------------------
/// Game State
///----------------------------------------------------------------
export interface GameState {
    // Game Metadata
    version: number; // not implemented

    // Game setup
    config: GameConfig; // Game id, player ids, initial game seeds
    rngCursors: RngCursors; // Holds shuffle/random info per player

    // Pregame setup
    setup: SetupState; // Holds coin flip result and mulligan decisions

    gameLog: LogEntry[]; // Flat chronological history of actions and signals

    // Game board
    definitions: Record<CardId, CardDef>; // card definitions, loaded at game start and immutable
    instances: Record<CardInstanceId, CardInstance>; // Card instances for all players
    playerZones: Record<PlayerId, PlayerZones>; // Card zones for each player, keeps the card locations

    // Turn and Phase
    turnOrder: PlayerId[];
    turn: number;
    turnPlayerId: PlayerId;
    phase: Phase;

    // Turn Tracking
    cardsPlayedThisTurn: CardInstanceId[]; // used for tracking same-turn played effects and eligible attackers
    // Effects used this turn, UNIQUE per (instanceId, effectId) — markEffectUsed is
    // idempotent. If an effect ever needs "used N times this turn", add a count to
    // UsedEffect rather than allowing duplicates. Pairs, not a string key, so ids are
    // never encoded/parsed.
    effectsUsedThisTurn: UsedEffect[];
    battlesThisTurn: BattleRecord[]; // used for tracking multiple attacks with the same character and same-turn attack effects
    
    currentBattle: BattleRecord | null;

    // Always needs to be cleared after action and set before state is returned
    decisionPoint: DecisionPoint | null; // Set when player decision is required to advance game state

    // Effects
    currentEffect: EffectContext | null;  // the currently resolving effect, if any
    effectQueue: EffectFrame[];
    stagingFrame: EffectFrame;

    statusEffects: StatusEffectDef[];

    // Game Outcome
    winner: PlayerId | null;
    endReason: EndReason | null;
}


///----------------------------------------------------------------
/// Zones
///----------------------------------------------------------------
export interface PlayerZones {
    characters: CardInstanceId[];
    deck: CardInstanceId[];
    donActive: CardInstanceId[];
    donDeck: CardInstanceId[];
    donRested: CardInstanceId[];
    hand: CardInstanceId[];
    leader: CardInstanceId[]; // Only one allowed, but creating space for alternate game modes with multiple or shared leaders
    life: CardInstanceId[];
    look: CardInstanceId[];   // system zone: temporarily holds cards being looked at or manipulated
    stage: CardInstanceId[];  // only one allowed, but using array for consistency and ease of indexing
    trash: CardInstanceId[];
    trigger: CardInstanceId[];
}


///----------------------------------------------------------------
/// Cards (runtime instances)
///----------------------------------------------------------------
// Base — fields every instance has





///----------------------------------------------------------------
/// Replay
///----------------------------------------------------------------
// interface Replay {
//   initialState: GameState;
//   actions: Action[];
//   rngEvents: RngEvent[];  // pre-recorded results, consumed in order
// }