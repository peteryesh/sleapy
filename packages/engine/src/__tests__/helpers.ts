import { produce } from "immer";
import type { GameState, PlayerZones } from "../types/state";
import type { CardInstance, CardDef } from "../types/card";
import type { CardId, CardInstanceId, PlayerId, Zone } from "../types/primitives";
import type { EffectContext, EffectDef, EffectId, EffectStep } from "../types/effect";
import type { CardFilter, CardStatType, EvalContext, TargetExpression, TargetLimit } from "../types/expression";
import { getZoneArray } from "../game/mechanics/helpers";
import { assertValidGameState } from "./invariants";

function emptyZones(): PlayerZones {
    return {
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

// The empty world, filled with exactly what the caller passes. CHECKS THE STATE
// INVARIANTS before returning: `instances` and `zoneOverrides` are separate inputs that
// must agree, and a test passing on a board the engine could never produce proves
// nothing. Pass zonesFromInstances(...) as `zoneOverrides` when the instances already
// say where they are. To test behavior against a missing card, put the card validly in
// a DIFFERENT zone rather than building a contradictory one.
export function createTestState(
    players: PlayerId[] = ["p1", "p2"],
    instances: Record<CardInstanceId, CardInstance> = {},
    zoneOverrides: Partial<Record<PlayerId, Partial<PlayerZones>>> = {},
    definitions: Record<string, CardDef> = {},
): GameState {
    const playerZones: Record<PlayerId, PlayerZones> = {};
    for (const id of players) {
        playerZones[id] = { ...emptyZones(), ...zoneOverrides[id] };
    }

    const allDefinitions = { ...definitions };
    for (const instance of Object.values(instances)) {
        if (instance.class === "DON") continue;
        if (!allDefinitions[instance.cardId]) {
            allDefinitions[instance.cardId] = {
                id: instance.cardId,
                name: instance.cardId,
                class: instance.class,
                colors: [],
                types: [],
                attributes: [],
                aliases: [],
                restrictions: [],
            };
        }
    }

    const state: GameState = {
        version: 0,
        config: {
            gameId: "test",
            playerIds: players,
            seeds: {
                game: BigInt(0) as any,
                players: Object.fromEntries(players.map(id => [id, BigInt(0) as any])),
            },
        },
        setup: {
            coinFlipWinner: players[0],
            firstPlayer: players[0],
            mulligan: Object.fromEntries(players.map(id => [id, "PENDING" as const])),
        },
        rngCursors: {
            game: BigInt(0),
            players: Object.fromEntries(players.map(id => [id, BigInt(0)])),
        },
        definitions: allDefinitions,
        instances,
        playerZones,
        turnOrder: players,
        turn: 1,
        turnPlayerId: players[0],
        phase: "MAIN",
        cardsPlayedThisTurn: [],
        effectsUsedThisTurn: [],
        currentBattle: null,
        battlesThisTurn: [],
        decisionPoint: null,
        currentEffect: null,
        effectQueue: [],
        stagingFrame: Object.fromEntries(players.map(id => [id, []])),
        statusEffects: [],
        gameLog: [],
        winner: null,
        endReason: null,
    };
    assertValidGameState(state);
    return state;
}

const ZONE_KEYS: Record<Zone, keyof PlayerZones> = {
    CHARACTERS: "characters", DECK: "deck", DON_ACTIVE: "donActive", DON_DECK: "donDeck",
    DON_RESTED: "donRested", HAND: "hand", LEADER: "leader", LIFE: "life", LOOK: "look",
    STAGE: "stage", TRASH: "trash", TRIGGER: "trigger",
};

// Zone arrays derived from each instance's own controller + currentZone, in the order
// given — so instances that already say where they are cannot disagree with the zones.
// Instances with no currentZone (DON attached to a card) are left out, as in a real game.
export function zonesFromInstances(
    instances: Record<CardInstanceId, CardInstance> | CardInstance[],
): Partial<Record<PlayerId, Partial<PlayerZones>>> {
    const zones: Partial<Record<PlayerId, Partial<PlayerZones>>> = {};
    for (const instance of Array.isArray(instances) ? instances : Object.values(instances)) {
        if (instance.currentZone === null) continue;
        const playerZones = (zones[instance.controller] ??= {});
        (playerZones[ZONE_KEYS[instance.currentZone]] ??= []).push(instance.instanceId);
    }
    return zones;
}

let _nextId = 1;
export function resetIds() { _nextId = 1; }

export function makeCharacterInstance(
    overrides: Partial<{ instanceId: CardInstanceId; controller: PlayerId; cardId: string; currentZone: Zone; }> = {}
): CardInstance {
    const instanceId = overrides.instanceId ?? `card-${_nextId++}`;
    return {
        instanceId,
        cardId: overrides.cardId ?? "test-card",
        controller: overrides.controller ?? "p1",
        class: "CHARACTER",
        currentZone: overrides.currentZone ?? "DECK",
        isRested: false,
        attachedDon: [],
        playedOnTurns: [],
        flipped: false,
    };
}

export function makeDonInstance(
    overrides: Partial<{ instanceId: CardInstanceId; controller: PlayerId; currentZone: Zone; }> = {}
): CardInstance {
    const instanceId = overrides.instanceId ?? `don-${_nextId++}`;
    const currentZone = overrides.currentZone ?? "DON_DECK";
    return {
        instanceId,
        class: "DON",
        controller: overrides.controller ?? "p1",
        currentZone,
        isRested: currentZone === "DON_RESTED",
        attachedTo: null,
        donValue: 1,
    };
}

export function makeStageInstance(
    overrides: Partial<{ instanceId: CardInstanceId; controller: PlayerId; cardId: string; currentZone: Zone; }> = {}
): CardInstance {
    const instanceId = overrides.instanceId ?? `stage-${_nextId++}`;
    return {
        instanceId,
        cardId: overrides.cardId ?? "test-stage",
        controller: overrides.controller ?? "p1",
        class: "STAGE",
        currentZone: overrides.currentZone ?? "DECK",
        isRested: false,
        attachedDon: [],
        playedOnTurns: [],
        flipped: false,
    };
}

export function makeEventInstance(
    overrides: Partial<{ instanceId: CardInstanceId; controller: PlayerId; cardId: string; currentZone: Zone; }> = {}
): CardInstance {
    const instanceId = overrides.instanceId ?? `event-${_nextId++}`;
    return {
        instanceId,
        cardId: overrides.cardId ?? "test-event",
        controller: overrides.controller ?? "p1",
        class: "EVENT",
        currentZone: overrides.currentZone ?? "DECK",
        isRested: false,
        playedOnTurns: [],
        flipped: false,
    };
}

export function makeLeaderInstance(
    overrides: Partial<{ instanceId: CardInstanceId; controller: PlayerId; cardId: string; }> = {}
): CardInstance {
    const instanceId = overrides.instanceId ?? `leader-${_nextId++}`;
    return {
        instanceId,
        cardId: overrides.cardId ?? "test-leader",
        controller: overrides.controller ?? "p1",
        class: "LEADER",
        currentZone: "LEADER",
        isRested: false,
        attachedDon: [],
    };
}

// Out-of-band board authoring for tests only: register an instance in state and
// append its id to a zone array directly — no operations, no signals, no log. Keeps
// `currentZone` (and `controller`, if a different one is passed) consistent with the
// zone the card lands in. Real, in-game placement must go through an operation; this
// only fabricates a starting position to assert against. Appends to the end of the
// zone array — place cards in the order you want them, or override `controller` to
// drop a card into an opponent's zone.
export function placeCard(
    state: GameState,
    instance: CardInstance,
    zone: Zone,
    controller: PlayerId = instance.controller,
): GameState {
    return produce(state, draft => {
        draft.instances[instance.instanceId] = { ...instance, controller, currentZone: zone };
        getZoneArray(draft, controller, zone).push(instance.instanceId);
    });
}

// ---------------------------------------------------------------------------
// Effect authoring
// ---------------------------------------------------------------------------

// The simplest activating effect: fires when this very card is played, active
// while it sits on the field, and does nothing. Override only the part under test.
export function makeEffectDef(overrides: Partial<EffectDef> = {}): EffectDef {
    return {
        activation: [{ signal: "CHARACTER_PLAYED", subject: { kind: "ANY_OF", filter: { kind: "THIS" } } }],
        activeZone: "CHARACTERS",
        oncePerTurn: false,
        steps: [],
        ...overrides,
    };
}

// A RESOLUTION step drawing a fixed number of cards. Pass a whole
// AmountExpression instead when the point of the test is the evaluation.
export function makeDrawStep(amount: number): EffectStep {
    return {
        kind: "RESOLUTION",
        operation: { type: "DRAW", amount: { kind: "LITERAL", value: amount } },
    };
}

// Builds the `definitions` argument for createTestState, with effects attached
// to one cardId. `cost` defaults to 0 for two reasons: calculateCost throws on an
// undefined cost, and a 0-cost card is playable with no DON on the board.
export function withEffect(
    cardId: CardId,
    effectDefs: Record<EffectId, EffectDef>,
    overrides: Partial<CardDef> = {},
): Record<CardId, CardDef> {
    return {
        [cardId]: {
            id: cardId,
            name: cardId,
            class: "CHARACTER",
            cost: 0,
            colors: [],
            types: [],
            attributes: [],
            aliases: [],
            restrictions: [],
            ...overrides,
            effectDefs,
        },
    };
}

// ---------------------------------------------------------------------------
// Full board fixture
// ---------------------------------------------------------------------------

export const BOARD_LEADER = "TEST-LEADER";
export const BOARD_FILLER = "TEST-FILLER";

const boardLeaderDef: CardDef = {
    id: BOARD_LEADER, name: BOARD_LEADER, class: "LEADER", power: 5000, life: 5,
    colors: [], types: [], attributes: [], aliases: [], restrictions: [],
};

const boardFillerDef: CardDef = {
    id: BOARD_FILLER, name: BOARD_FILLER, class: "CHARACTER", cost: 0, power: 1000,
    colors: [], types: [], attributes: [], aliases: [], restrictions: [],
};

export type GameBoard = {
    state: GameState;
    // Instances created for each player's hand, in the order their cardIds were
    // requested — this is how a test names the card it wants to play.
    hands: Record<PlayerId, CardInstance[]>;
};

// A realistic mid-game board, assembled directly rather than played into.
//
// Driving a real game to this point would mean walking setup, mulligan and N
// turns of the phase machine — which tests the phase machine, not whatever the
// test is actually about. A test should fail for one reason.
//
// DON defaults to the game cap of 10 active so cost never has to be reasoned
// about: every card in the pool is affordable and cost drops out as a variable.
//
// The state is checked with assertValidGameState before it is returned, because
// a hand-built board can be malformed in ways a real game never produces, and a
// test passing against an unreachable state is worse than no test.
export function makeGameBoard(opts: {
    players?: PlayerId[];
    definitions?: Record<CardId, CardDef>;
    hands?: Partial<Record<PlayerId, CardId[]>>;
    deckSize?: number;
    lifeSize?: number;
    donActive?: number;
    turnPlayer?: PlayerId;
} = {}): GameBoard {
    const players = opts.players ?? ["p1", "p2"];
    const deckSize = opts.deckSize ?? 10;
    const lifeSize = opts.lifeSize ?? 5;
    const donActive = opts.donActive ?? 10;
    const turnPlayer = opts.turnPlayer ?? players[0];

    const instances: Record<CardInstanceId, CardInstance> = {};
    const zones: Partial<Record<PlayerId, Partial<PlayerZones>>> = {};
    const hands: Record<PlayerId, CardInstance[]> = {};

    const register = (instance: CardInstance): CardInstanceId => {
        instances[instance.instanceId] = instance;
        return instance.instanceId;
    };

    for (const controller of players) {
        const leader = makeLeaderInstance({ controller, cardId: BOARD_LEADER });
        const deck = Array.from({ length: deckSize }, () =>
            makeCharacterInstance({ controller, cardId: BOARD_FILLER, currentZone: "DECK" }));
        const life = Array.from({ length: lifeSize }, () =>
            makeCharacterInstance({ controller, cardId: BOARD_FILLER, currentZone: "LIFE" }));
        const don = Array.from({ length: donActive }, () =>
            makeDonInstance({ controller, currentZone: "DON_ACTIVE" }));
        const hand = (opts.hands?.[controller] ?? []).map(cardId =>
            makeCharacterInstance({ controller, cardId, currentZone: "HAND" }));

        hands[controller] = hand;
        zones[controller] = {
            leader: [register(leader)],
            deck: deck.map(register),
            life: life.map(register),
            donActive: don.map(register),
            hand: hand.map(register),
        };
    }

    const base = createTestState(players, instances, zones, {
        [BOARD_LEADER]: boardLeaderDef,
        [BOARD_FILLER]: boardFillerDef,
        ...opts.definitions,
    });

    const state: GameState = {
        ...base,
        turn: 1,
        turnPlayerId: turnPlayer,
        phase: "MAIN",
        decisionPoint: { type: "MAIN_ACTION", player: turnPlayer },
    };

    assertValidGameState(state);
    return { state, hands };
}

// A promoted effect parked at the start of its step list. Stands in for what
// promoteEffect would have built, so resolution and stepping can be tested
// without staging a signal first.
export function makeEffectContext(overrides: Partial<EffectContext> = {}): EffectContext {
    return {
        playerId: "p1",
        effectId: "effect-1",
        instanceId: "card-1",
        // Defaults to the "activated, carries nothing" case — correct for any test
        // whose effect is not about its subjects. Override to assert on them.
        subjects: [],
        cursor: 0,
        // null, not [] — no selection is running. `[]` would claim one is open
        // before any step has executed.
        selected: null,
        locals: {},
        steps: [],
        // Override to test consumption directly. A test that also goes through the
        // emitter gate should set the flag on the definition (withEffect) instead, so
        // the context and the definition agree.
        oncePerTurn: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Targeting fixtures
// ---------------------------------------------------------------------------
//
// Shared by evaluators/targetExpression.test.ts (candidates and predicates) and
// effects/target.test.ts (the prompt loop). Built on createTestState + placeCard, so
// the board is the empty world filled with exactly what the test lists.

// A character def with real stats. createTestState's auto-generated defs carry no
// cost, power or counter, so captureSnapshot reports them as null — and a null stat
// throws inside getStatFromLimitWeight for any WEIGHTED limit.
export function makeCharacterDef(id: CardId, stats: Partial<CardDef> = {}): CardDef {
    return {
        id,
        name: id,
        class: "CHARACTER",
        cost: 0,
        power: 1000,
        counter: 1000,
        colors: [],
        types: [],
        attributes: [],
        aliases: [],
        restrictions: [],
        ...stats,
    };
}

// The stat ladder. Use NO_COUNTER when the null-stat throw is the thing under test,
// and the others everywhere else.
export const STAT_CARD = {
    SOURCE: "TEST-SOURCE",
    ZERO: "TEST-ZERO",        // cost 0 / power 0: weighs nothing against a WEIGHTED limit
    LOW: "TEST-LOW",          // cost 1 / power 1000
    MID: "TEST-MID",          // cost 3 / power 3000
    HIGH: "TEST-HIGH",        // cost 5 / power 5000
    NEGATIVE: "TEST-NEG",     // power -1000 — see note on the def
    NO_COUNTER: "TEST-NOCTR", // counter absent: snapshot.counter is null
} as const;

export const STAT_DEFINITIONS: Record<CardId, CardDef> = {
    [STAT_CARD.SOURCE]: makeCharacterDef(STAT_CARD.SOURCE),
    [STAT_CARD.ZERO]: makeCharacterDef(STAT_CARD.ZERO, { cost: 0, power: 0 }),
    [STAT_CARD.LOW]: makeCharacterDef(STAT_CARD.LOW, { cost: 1, power: 1000 }),
    [STAT_CARD.MID]: makeCharacterDef(STAT_CARD.MID, { cost: 3, power: 3000 }),
    [STAT_CARD.HIGH]: makeCharacterDef(STAT_CARD.HIGH, { cost: 5, power: 5000 }),
    // A stand-in for a debuffed character. Status effects are not wired into this
    // fixture, so the negative value lives on the printed power instead — unreachable
    // in a real game, but captureSnapshot reports it the same way. Whether a negative
    // weight should ADD capacity is an unconfirmed ruling (see selection.ts).
    [STAT_CARD.NEGATIVE]: makeCharacterDef(STAT_CARD.NEGATIVE, { cost: 1, power: -1000 }),
    [STAT_CARD.NO_COUNTER]: makeCharacterDef(STAT_CARD.NO_COUNTER, { counter: undefined }),
};

export type CardSpec = { cardId: CardId; zone: Zone; controller?: PlayerId };

export type TargetBoard = {
    state: GameState;
    // The effect's own card, on p1's field. Every EvalContext points at it.
    source: CardInstanceId;
    // Instance ids in the order their specs were passed, so a test names cards by
    // position: `const [low, high] = board.ids;`.
    ids: CardInstanceId[];
};

// A two-player MAIN-phase board with the source on p1's field plus whatever cards the
// test lists. Cards go through placeCard, so currentZone and the zone arrays always
// agree, and the result is checked against the state invariants — a test passing on a
// board the engine could never produce proves nothing.
export function makeTargetBoard(cards: CardSpec[] = []): TargetBoard {
    let state = createTestState(["p1", "p2"], {}, {}, STAT_DEFINITIONS);

    const sourceInstance = makeCharacterInstance({ controller: "p1", cardId: STAT_CARD.SOURCE });
    state = placeCard(state, sourceInstance, "CHARACTERS");

    const ids: CardInstanceId[] = [];
    for (const spec of cards) {
        const instance = makeCharacterInstance({ controller: spec.controller ?? "p1", cardId: spec.cardId });
        state = placeCard(state, instance, spec.zone);
        ids.push(instance.instanceId);
    }

    assertValidGameState(state);
    return { state, source: sourceInstance.instanceId, ids };
}

// The standard spread: a cost ladder on each side of the field, plus one card in a
// zone a field-targeting expression should never reach. Use makeTargetBoard directly
// when a test needs a specific shape (e.g. a pool with no cost-0 cards).
export function makeTargetingBoard() {
    const board = makeTargetBoard([
        { cardId: STAT_CARD.LOW, zone: "CHARACTERS", controller: "p1" },
        { cardId: STAT_CARD.MID, zone: "CHARACTERS", controller: "p1" },
        { cardId: STAT_CARD.LOW, zone: "CHARACTERS", controller: "p2" },
        { cardId: STAT_CARD.HIGH, zone: "CHARACTERS", controller: "p2" },
        { cardId: STAT_CARD.MID, zone: "HAND", controller: "p1" },
    ]);
    const [selfLow, selfMid, oppLow, oppHigh, selfHand] = board.ids;
    return { ...board, selfLow, selfMid, oppLow, oppHigh, selfHand };
}

// The context a resolving effect sourced from `source` would evaluate under.
export function makeEvalContext(source: CardInstanceId, self: PlayerId = "p1"): EvalContext {
    return { self, source, subjects: [] };
}

// Parks an effect on the board's source as currentEffect, cursor 0, nothing stepping
// it yet. Two uses: isValidSelection reads `selected` off it (pass `selected`), and
// the prompt loop starts from it (pass `steps`, then call advance).
export function parkEffect(board: TargetBoard, overrides: Partial<EffectContext> = {}): GameState {
    const playerId = board.state.instances[board.source].controller;
    return {
        ...board.state,
        currentEffect: makeEffectContext({ playerId, instanceId: board.source, ...overrides }),
    };
}

export function selfTarget(): TargetExpression {
    return { kind: "SELF_TARGET" };
}

export function selector(zones: Zone[], filter?: CardFilter): TargetExpression {
    return { kind: "SELECTOR_TARGET", zones, ...(filter ? { filter } : {}) };
}

export function playerChoice(
    zones: Zone[],
    limits: TargetLimit[],
    opts: { filter?: CardFilter; chooser?: "SELF" | "OPPONENT" } = {},
): TargetExpression {
    return {
        kind: "PLAYER_CHOICE_TARGET",
        zones,
        limits,
        chooser: opts.chooser ?? "SELF",
        ...(opts.filter ? { filter: opts.filter } : {}),
    };
}

// Fresh objects every call: decrementCapacity mutates the limit it is handed, so a
// limit shared between cases would carry one case's decrements into the next.
export function cardsLimit(capacity: number, min = 0): TargetLimit {
    return { kind: "CARDS", min: { kind: "LITERAL", value: min }, capacity: { kind: "LITERAL", value: capacity } };
}

export function weightedLimit(weight: CardStatType, capacity: number): TargetLimit {
    return { kind: "WEIGHTED", weight, capacity: { kind: "LITERAL", value: capacity } };
}

// Reads a LITERAL capacity back out, for asserting on decrementCapacity's result.
export function capacityOf(limit: TargetLimit): number {
    if (limit.capacity.kind !== "LITERAL") throw new Error(`capacityOf only reads LITERAL capacities`);
    return limit.capacity.value;
}

// A RESOLUTION step that only carries a target expression. REST is used because it is
// the one targeted operation that does not throw once selection finishes.
export function makeTargetedStep(target: TargetExpression): EffectStep {
    return { kind: "RESOLUTION", operation: { type: "REST", target } };
}

// Target order follows playerZones key order and zone order, which is an
// implementation detail. Compare id lists through this, never as raw arrays.
export function sortedIds(ids: CardInstanceId[]): CardInstanceId[] {
    return [...ids].sort();
}

export const CONTROLLED_BY_SELF: CardFilter = { kind: "CONTROLLER", controller: "SELF" };
export const CONTROLLED_BY_OPPONENT: CardFilter = { kind: "CONTROLLER", controller: "OPPONENT" };
