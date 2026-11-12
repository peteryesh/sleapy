import { describe, it, expect, beforeEach } from "vitest";
import type { GameState } from "../../types/state";
import {
    _cardsMoveToLife,
    sendTopDeckToLife,
} from "../../game/operations/zones/life";
import { InvalidActionError } from "../../errors";
import { createTestState, makeCharacterInstance, makeDonInstance, makeLeaderInstance, resetIds } from "../helpers";
import { assertValidGameState } from "../invariants";

let state!: GameState;

beforeEach(() => {
    resetIds();
    state = createTestState();
});

describe("_cardsMoveToLife", () => {
    it("moves ids from current zone to top of life", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const next = _cardsMoveToLife(state, "p1", [c1.instanceId, c2.instanceId], "DECK", "TOP", { kind: "RULE" });

        // ids removed from origin zone
        expect(next.playerZones["p1"].deck).toHaveLength(0);
        // ids pushed to life top in order (life[0] is the last id processed)
        expect(next.playerZones["p1"].life).toEqual([c2.instanceId, c1.instanceId]);
        assertValidGameState(next);
    });
    it("moves ids from current zone to bottom of life", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const next = _cardsMoveToLife(state, "p1", [c1.instanceId, c2.instanceId], "DECK", "BOTTOM", { kind: "RULE" });

        // ids removed from origin zone
        expect(next.playerZones["p1"].deck).toHaveLength(0);
        // ids appended to life bottom in order
        expect(next.playerZones["p1"].life).toEqual([c1.instanceId, c2.instanceId]);
        assertValidGameState(next);
    });
    it("attempts to move id to life when id does not exist in source", () => {
        // Validly in HAND, so a move whose source is DECK finds nothing there.
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "HAND" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1 }, {
            p1: { hand: [c1.instanceId] },
        });

        expect(() => _cardsMoveToLife(state, "p1", [c1.instanceId], "DECK", "TOP", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
    it("attempts to move DON to life", () => {
        const don = makeDonInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [don.instanceId]: don }, {
            p1: { donDeck: [don.instanceId] },
        });

        expect(() => _cardsMoveToLife(state, "p1", [don.instanceId], "DON_DECK", "TOP", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
    it("attempts to move LEADER to life", () => {
        // leaders cannot be removed from LEADER zone — place in trash to isolate the class guard
        const leader = makeLeaderInstance({ controller: "p1" });
        const leaderInTrash = { ...leader, currentZone: "TRASH" as const };
        state = createTestState(["p1", "p2"], { [leader.instanceId]: leaderInTrash }, {
            p1: { trash: [leader.instanceId] },
        });

        expect(() => _cardsMoveToLife(state, "p1", [leader.instanceId], "TRASH", "TOP", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
});

describe("sendTopDeckToLife", () => {
    it("moves top card in deck to top life", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const topId = state.playerZones["p1"].deck[0];
        const next = sendTopDeckToLife(state, "p1", 1, "TOP", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).not.toContain(topId);
        expect(next.playerZones["p1"].life[0]).toBe(topId);
        assertValidGameState(next);
    });
    it("moves top N cards of top deck to top life", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        const c3 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2, [c3.instanceId]: c3 }, {
            p1: { deck: [c1.instanceId, c2.instanceId, c3.instanceId] },
        });

        const deckIds = state.playerZones["p1"].deck.slice(0, 3);
        const next = sendTopDeckToLife(state, "p1", 3, "TOP", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        // each card pushed to top individually, so last deck card ends at life[0]
        expect(next.playerZones["p1"].life).toEqual([...deckIds].reverse());
        assertValidGameState(next);
    });
    it("moves as many cards as possible from top deck to top life", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const next = sendTopDeckToLife(state, "p1", 10, "TOP", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        expect(next.playerZones["p1"].life).toHaveLength(2);
        assertValidGameState(next);
    });
    it("moves top card in deck to life bottom", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const topId = state.playerZones["p1"].deck[0];
        const next = sendTopDeckToLife(state, "p1", 1, "BOTTOM", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).not.toContain(topId);
        expect(next.playerZones["p1"].life.at(-1)).toBe(topId);
        assertValidGameState(next);
    });
    it("moves top N cards of top deck to life bottom", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        const c3 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2, [c3.instanceId]: c3 }, {
            p1: { deck: [c1.instanceId, c2.instanceId, c3.instanceId] },
        });

        const deckIds = state.playerZones["p1"].deck.slice(0, 3);
        const next = sendTopDeckToLife(state, "p1", 3, "BOTTOM", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        // each card appended to bottom individually, so order matches deck order
        expect(next.playerZones["p1"].life).toEqual([...deckIds]);
        assertValidGameState(next);
    });
    it("moves as many cards as possible to life bottom", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const next = sendTopDeckToLife(state, "p1", 10, "BOTTOM", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        expect(next.playerZones["p1"].life).toHaveLength(2);
        assertValidGameState(next);
    });
    it("does nothing when deck is empty", () => {
        const next = sendTopDeckToLife(state, "p1", 1, "TOP", { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        expect(next.playerZones["p1"].life).toHaveLength(0);
        assertValidGameState(next);
    });
});
