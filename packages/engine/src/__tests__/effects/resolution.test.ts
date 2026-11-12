import { describe, it, expect, beforeEach } from "vitest";
import {
    consumeEffect,
    evalContextOf,
    executeOperation,
    executeResolution,
    groupAndOrderTargetsByPlayer,
    resolveTargets,
} from "../../game/effects/resolution";
import { commitEffectFrame, stageEffect } from "../../game/mechanics";
import {
    CONTROLLED_BY_OPPONENT,
    CONTROLLED_BY_SELF,
    cardsLimit,
    createTestState,
    makeCharacterInstance,
    makeDrawStep,
    makeEffectContext,
    makeEffectDef,
    makeTargetingBoard,
    parkEffect,
    playerChoice,
    resetIds,
    selector,
    selfTarget,
    sortedIds,
    withEffect,
} from "../helpers";
import type { GameState } from "../../types/state";
import type { CardInstance } from "../../types/card";
import type { PlayerId } from "../../types/primitives";

// Phase 1.B — executeResolution + evalContextOf.
//
// executeResolution is the adapter from EffectOperation data to an operation
// call. It runs exactly one operation and returns state; it owns none of the
// cursor/consumption semantics, which belong to advanceEffect (stepper.test.ts).
//
// Testable in full isolation: hand-build an EffectContext with makeEffectContext,
// hand a DRAW operation straight in. No staging, no conductor, no reducer.
//
// Deck sizing matters — emit runs a deckout check on BOTH players after every
// signal, so a deck that empties mid-test ends the game instead of drawing.

const FILLER_CARD = "OP01-FILLER";
const SOURCE_CARD = "OP01-SOURCE";

function makeDeck(controller: PlayerId, count: number): CardInstance[] {
    return Array.from({ length: count }, () =>
        makeCharacterInstance({ controller, cardId: FILLER_CARD, currentZone: "DECK" }));
}

function instanceMap(instances: CardInstance[]): Record<string, CardInstance> {
    return Object.fromEntries(instances.map(i => [i.instanceId, i]));
}

// A board where both players hold a stocked deck and p1 controls `source` on the
// field. Nothing here has effectDefs, so emit never reaches the staging loop.
function board(extra: CardInstance[] = []): { state: GameState; source: CardInstance } {
    const source = makeCharacterInstance({ controller: "p1", cardId: SOURCE_CARD, currentZone: "CHARACTERS" });
    const p1Deck = makeDeck("p1", 5);
    const p2Deck = makeDeck("p2", 5);

    const state = createTestState(
        ["p1", "p2"],
        instanceMap([source, ...p1Deck, ...p2Deck, ...extra]),
        {
            p1: {
                characters: [source.instanceId, ...extra.filter(c => c.controller === "p1").map(c => c.instanceId)],
                deck: p1Deck.map(c => c.instanceId),
            },
            p2: {
                characters: extra.filter(c => c.controller === "p2").map(c => c.instanceId),
                deck: p2Deck.map(c => c.instanceId),
            },
        },
    );
    return { state, source };
}

beforeEach(() => {
    resetIds();
});

// The whole function: EffectContext describes whose effect is resolving,
// EvalContext is what the expression evaluators consume. This mapping is the only
// place "who is acting" is decided, which is why it gets its own tests — if it is
// backwards, every filter and amount in the game silently evaluates for the wrong
// player.
describe("evalContextOf", () => {
    it("maps EffectContext.playerId onto EvalContext.self", () => {
        const ctx = makeEffectContext({ playerId: "p2", instanceId: "card-9" });
        expect(evalContextOf(ctx).self).toBe("p2");
    });

    it("maps EffectContext.instanceId onto EvalContext.source", () => {
        const ctx = makeEffectContext({ playerId: "p2", instanceId: "card-9" });
        expect(evalContextOf(ctx).source).toBe("card-9");
    });
});

describe("execute operations", () => {
    describe("DRAW", () => {
        it("draws the evaluated amount into the effect controller's hand", () => {
            const { state, source } = board();
            const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });

            const next = executeResolution(state, ctx, {
                type: "DRAW",
                amount: { kind: "LITERAL", value: 2 },
            });

            expect(next.playerZones["p1"].hand).toHaveLength(2);
            expect(next.playerZones["p1"].deck).toHaveLength(3);
        });

        // Guards the DSL contract: the amount must round-trip through
        // evalAmountExpression, never be read off `.value`. A COUNT expression is
        // the cheapest way to prove it — it has no `.value` field at all.
        it("evaluates a COUNT amount against board state rather than reading a literal", () => {
            const ally = makeCharacterInstance({ controller: "p1", cardId: FILLER_CARD, currentZone: "CHARACTERS" });
            const { state, source } = board([ally]);
            const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });

            // two cards sit in CHARACTERS: the source and the ally
            const next = executeResolution(state, ctx, {
                type: "DRAW",
                amount: { kind: "COUNT", zones: ["CHARACTERS"], filter: { kind: "ANY" } },
            });

            expect(next.playerZones["p1"].hand).toHaveLength(2);
        });

        // ctx.playerId, not the controller of whatever card happens to be drawn.
        it("draws for the effect's controller when both players hold decks", () => {
            const { state } = board();
            const ctx = makeEffectContext({ playerId: "p2", instanceId: "card-does-not-matter" });

            const next = executeResolution(state, ctx, {
                type: "DRAW",
                amount: { kind: "LITERAL", value: 1 },
            });

            expect(next.playerZones["p2"].hand).toHaveLength(1);
            expect(next.playerZones["p1"].hand).toHaveLength(0);
        });

        // { kind: "EFFECT", sourceId } — not RULE. emit reads cause.sourceId to
        // attribute wins, so effect-caused movement has to name its source.
        it("emits the draw with an EFFECT cause carrying the source instanceId", () => {
            const { state, source } = board();
            const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });

            const next = executeResolution(state, ctx, {
                type: "DRAW",
                amount: { kind: "LITERAL", value: 1 },
            });

            const drawSignals = next.gameLog
                .filter(entry => entry.kind === "SIGNAL")
                .map(entry => (entry as { kind: "SIGNAL"; signal: any }).signal)
                .filter(signal => signal.type === "CARDS_SENT_TO_HAND");

            expect(drawSignals).toHaveLength(1);
            expect(drawSignals[0].cause).toEqual({ kind: "EFFECT", sourceId: source.instanceId });
        });

        it("is a no-op when the amount evaluates to 0", () => {
            const { state, source } = board();
            const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });
            const logLength = state.gameLog.length;

            const next = executeResolution(state, ctx, {
                type: "DRAW",
                amount: { kind: "LITERAL", value: 0 },
            });

            expect(next.playerZones["p1"].hand).toHaveLength(0);
            expect(next.playerZones["p1"].deck).toHaveLength(5);
            // a no-op must not log a signal either
            expect(next.gameLog).toHaveLength(logLength);
        });
    });

    // One block per EffectOperation. Each pins what the BRANCH adds — which cards,
    // whose zone, the cause — not what the underlying zone operation means, which is
    // covered in operations/*.test.ts. When one is implemented, remove its throw test
    // below.

    // --- Targeted operations: targets arrive through resolveTargets. The untargeted
    // control card is the point of the first test in each block: the likeliest bug is
    // acting on every candidate rather than the resolved targets.

    describe("ADD_TO_HAND", () => {
        it.todo("moves exactly its targets to their controller's hand, leaving an untargeted card in place");
        it.todo("reveal: true makes the moved cards visible to both players");
        it.todo("an empty target list is a no-op");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
    });

    describe("REST", () => {
        it.todo("rest characters, rests exactly its targets, leaving an untargeted card in the same zone active");
        it.todo("rest don, rests exactly its targets, leaving an untargeted card in the same zone active");
        it.todo("rest mix of zones including don, rests exactly its targets, leaving an untargeted card in the same zone active");
        it.todo("an already-rested target stays rested");
        it.todo("an empty target list is a no-op");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
        it.todo("targets on both sides are rested turn player first");
    });

    describe("TRASH", () => {
        it.todo("trashes exactly its targets into their controller's trash, leaving an untargeted card in place");
        it.todo("an empty target list is a no-op");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
        it.todo("targets on both sides are trashed turn player first");
    });

    describe("KO", () => {
        it.todo("K.O.s exactly its targets, leaving an untargeted character on the field");
        it.todo("reports the removal as a K.O., not a trash or a bounce");
        it.todo("an empty target list is a no-op");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
        it.todo("targets on both sides are K.O.'d turn player first");
    });

    describe("RETURN_DON", () => {
        it.todo("returns exactly its targeted DON to their controller's DON deck");
        it.todo("an attached DON is detached from its card when returned");
        it.todo("an empty target list is a no-op");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
    });

    // --- Amount operations: no target expression. `amount` must be evaluated
    // (never read off `.value`), and the effect's controller is the player acted on.

    describe("LIFE_TO_HAND", () => {
        it.todo("moves the evaluated amount from lifePos of the controller's life to their hand");
        it.todo("TOP and BOTTOM take from opposite ends of life");
        it.todo("an amount larger than the remaining life moves what there is");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
    });

    describe("LIFE_TRASH", () => {
        it.todo("moves the evaluated amount from lifePos of the controller's life to their trash");
        it.todo("an amount larger than the remaining life moves what there is");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
    });

    describe("LIFE_FLIP", () => {
        it.todo("sets the evaluated amount of life cards at lifePos to the given orientation");
        it.todo("a card already in that orientation is unchanged");
        it.todo("emits with an EFFECT cause carrying the source instanceId");
    });

    describe("LOOK", () => {
        it.todo("moves the evaluated amount from `from` into the controller's LOOK zone");
        it.todo("fromPos TOP and BOTTOM take from opposite ends of the zone");
        it.todo("an amount larger than the zone looks at what there is");
    });

    // The order is the player's choice, so this needs SUBMIT_REORDER, which is still
    // unimplemented in the reducer.
    describe("REORDER", () => {
        it.todo("moves every LOOK card to `to` at toPos in the order the player submits");
        it.todo("leaves the LOOK zone empty");
    });

    // Defined in the EffectOperation union but unimplemented. They must fail
    // loudly — a silently skipped operation looks like a resolved effect.
    it("throws for LOOK operations", () => {
        const { state, source } = board();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });

        expect(() => executeResolution(state, ctx, {
            type: "LOOK",
            from: "DECK",
            amount: { kind: "LITERAL", value: 1 },
        })).toThrow();
    });

    it("throws for ADD_TO_HAND operations", () => {
        const { state, source } = board();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });

        expect(() => executeResolution(state, ctx, { type: "ADD_TO_HAND" })).toThrow();
    });

    it("throws for REORDER operations", () => {
        const { state, source } = board();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId });

        expect(() => executeResolution(state, ctx, {
            type: "REORDER",
            from: "LOOK",
            to: "DECK",
            toPos: "TOP",
        })).toThrow();
    });

    // Boundary check: resolution runs the operation and nothing else. Moving the
    // cursor and clearing currentEffect belong to advanceEffect.
    it("leaves ctx.cursor and state.currentEffect untouched", () => {
        const { state, source } = board();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId, cursor: 0 });
        const withEffectInFlight: GameState = { ...state, currentEffect: ctx };

        const next = executeResolution(withEffectInFlight, ctx, {
            type: "DRAW",
            amount: { kind: "LITERAL", value: 1 },
        });

        expect(ctx.cursor).toBe(0);
        expect(next.currentEffect).toEqual(ctx);
    });
});

// executeOperation is executeResolution minus the two things in front of the switch:
// the target-selection gate and consumption. These pin that split, so individual
// operations can be unit tested here without a selection running or a use recorded.
describe("executeOperation", () => {
    it("runs the operation without raising a target prompt", () => {
        const board = makeTargetingBoard();
        const state = parkEffect(board);
        const ctx = state.currentEffect!;
        const operation = { type: "REST" as const, target: playerChoice(["CHARACTERS"], [cardsLimit(1)]) };

        // Control: the same operation through executeResolution does prompt.
        expect(executeResolution(state, ctx, operation).decisionPoint?.type).toBe("EFFECT_TARGET");
        expect(executeOperation(state, ctx, operation).decisionPoint).toBeNull();
    });

    it("does not consume a once-per-turn use", () => {
        const { state, source } = board();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId, oncePerTurn: true });

        const next = executeOperation(state, ctx, { type: "DRAW", amount: { kind: "LITERAL", value: 1 } });

        expect(next.playerZones["p1"].hand).toHaveLength(1);
        expect(next.effectsUsedThisTurn).toEqual([]);
    });
});

describe("resolveTargets", () => {
    beforeEach(() => resetIds());

    it("SELF_TARGET resolves to the effect's own card", () => {
        const board = makeTargetingBoard();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: board.source });

        expect(resolveTargets(board.state, ctx, selfTarget())).toEqual([board.source]);
    });

    // CONTROLLER is context-dependent, so this also proves `self` comes from the
    // effect context rather than from whoever controls the board.
    it("SELECTOR_TARGET resolves to every card the expression matches", () => {
        const board = makeTargetingBoard();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: board.source });

        const targets = resolveTargets(board.state, ctx, selector(["CHARACTERS"], CONTROLLED_BY_OPPONENT));

        expect(sortedIds(targets)).toEqual(sortedIds([board.oppLow, board.oppHigh]));
    });

    // `selected` is authoritative: the picks were validated as they were made, so
    // resolution must not re-filter them. oppHigh fails this expression's filter and
    // still comes back — re-running the filter here would read a board that may have
    // moved on since the pick.
    it("PLAYER_CHOICE_TARGET resolves to the selection verbatim", () => {
        const board = makeTargetingBoard();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: board.source, selected: [board.oppHigh, board.selfLow] });
        const expression = playerChoice(["CHARACTERS"], [cardsLimit(2)], { filter: CONTROLLED_BY_SELF });

        expect(resolveTargets(board.state, ctx, expression)).toEqual([board.oppHigh, board.selfLow]);
    });

    it("PLAYER_CHOICE_TARGET with no selection resolves to nothing", () => {
        const board = makeTargetingBoard();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: board.source, selected: null });

        expect(resolveTargets(board.state, ctx, playerChoice(["CHARACTERS"], [cardsLimit(1)]))).toEqual([]);
    });
});

// Whole-value assertions: the groups, their order, and the order within each group
// (input order is preserved) are all part of the contract.
describe("groupAndOrderTargetsByPlayer", () => {
    beforeEach(() => resetIds());

    it("all targets belong to one player", () => {
        const board = makeTargetingBoard();

        expect(groupAndOrderTargetsByPlayer(board.state, [board.selfLow, board.selfMid])).toEqual([
            { playerId: "p1", targets: [board.selfLow, board.selfMid] },
        ]);
    });

    // The non-turn player's card is passed FIRST, so input order cannot be what puts
    // the turn player's group first.
    it("some targets belong to both players", () => {
        const board = makeTargetingBoard();

        expect(groupAndOrderTargetsByPlayer(board.state, [board.oppLow, board.selfLow, board.oppHigh])).toEqual([
            { playerId: "p1", targets: [board.selfLow] },
            { playerId: "p2", targets: [board.oppLow, board.oppHigh] },
        ]);
    });

    // With p2 as turn player, so neither playerIds order nor "p1 first" can explain
    // the result.
    it("puts the turn player's group first when the turn player is p2", () => {
        const board = makeTargetingBoard();
        const state: GameState = { ...board.state, turnPlayerId: "p2" };

        expect(groupAndOrderTargetsByPlayer(state, [board.selfLow, board.oppLow])).toEqual([
            { playerId: "p2", targets: [board.oppLow] },
            { playerId: "p1", targets: [board.selfLow] },
        ]);
    });

    it("no target list", () => {
        const board = makeTargetingBoard();

        expect(groupAndOrderTargetsByPlayer(board.state, [])).toEqual([]);
    });
});

describe("consumeEffect", () => {
    const OPT_CARD = "OP01-ONCE";

    // Two p1 characters sharing a definition with two once-per-turn effects, so the
    // purge has neighbours it must leave alone: the same effect on ANOTHER card, and
    // ANOTHER effect on the same card.
    function queueBoard() {
        const source = makeCharacterInstance({ controller: "p1", cardId: OPT_CARD, currentZone: "CHARACTERS" });
        const other = makeCharacterInstance({ controller: "p1", cardId: OPT_CARD, currentZone: "CHARACTERS" });
        const state = createTestState(
            ["p1", "p2"],
            instanceMap([source, other]),
            { p1: { characters: [source.instanceId, other.instanceId] } },
            withEffect(OPT_CARD, {
                e1: makeEffectDef({ oncePerTurn: true, steps: [makeDrawStep(1)] }),
                e2: makeEffectDef({ oncePerTurn: true, steps: [makeDrawStep(1)] }),
            }),
        );
        return { state, source: source.instanceId, other: other.instanceId };
    }

    // Every staged or queued effect, as "instanceId/effectId", across all frames.
    function pending(state: GameState): string[] {
        return [...state.effectQueue, state.stagingFrame]
            .flatMap(frame => Object.values(frame).flat())
            .map(ctx => `${ctx.instanceId}/${ctx.effectId}`)
            .sort();
    }

    it("effect used, appears in effectsUsedThisTurn", () => {
        const { state, source } = queueBoard();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source, effectId: "e1", oncePerTurn: true });

        const next = consumeEffect(state, ctx);

        expect(next.effectsUsedThisTurn).toEqual([{ instanceId: source, effectId: "e1" }]);
    });

    it("once per turn effect used, multiple of same effect in queue", () => {
        let { state, source, other } = queueBoard();
        // Copies of source/e1 in two committed frames and in the open staging frame,
        // alongside the two neighbours.
        state = stageEffect(state, "p1", source, "e1", []);
        state = stageEffect(state, "p1", source, "e2", []);
        state = commitEffectFrame(state);
        state = stageEffect(state, "p1", source, "e1", []);
        state = stageEffect(state, "p1", other, "e1", []);
        state = commitEffectFrame(state);
        state = stageEffect(state, "p1", source, "e1", []);
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source, effectId: "e1", oncePerTurn: true });

        const next = consumeEffect(state, ctx);

        expect(pending(next)).toEqual([`${other}/e1`, `${source}/e2`].sort());
    });

    it("an effect without once-per-turn is not recorded and keeps its queued copies", () => {
        let { state, source } = queueBoard();
        state = stageEffect(state, "p1", source, "e1", []);
        state = commitEffectFrame(state);
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source, effectId: "e1", oncePerTurn: false });

        expect(consumeEffect(state, ctx)).toBe(state);
    });

    it("consuming the same use twice records it once", () => {
        const { state, source } = queueBoard();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source, effectId: "e1", oncePerTurn: true });

        const next = consumeEffect(consumeEffect(state, ctx), ctx);

        expect(next.effectsUsedThisTurn).toEqual([{ instanceId: source, effectId: "e1" }]);
    });

    // The call site: executeResolution consumes before running the operation. Run
    // twice to stand in for a two-step effect — still one recorded use.
    it("executeResolution consumes once per effect, not once per step", () => {
        const { state, source } = board();
        const ctx = makeEffectContext({ playerId: "p1", instanceId: source.instanceId, effectId: "e1", oncePerTurn: true });
        const draw = { type: "DRAW" as const, amount: { kind: "LITERAL" as const, value: 1 } };

        const next = executeResolution(executeResolution(state, ctx, draw), ctx, draw);

        expect(next.playerZones["p1"].hand).toHaveLength(2);
        expect(next.effectsUsedThisTurn).toEqual([{ instanceId: source.instanceId, effectId: "e1" }]);
    });
});