import { describe, it, expect, beforeEach } from "vitest";
import type { GameState } from "../../types/state";
import {
    _cardsMoveToTrash,
    sendTopDeckToTrash,
    sendTopLifeToTrash,
} from "../../game/operations/zones/trash";
import { InvalidActionError } from "../../errors";
import { createTestState, makeCharacterInstance, makeDonInstance, makeLeaderInstance, resetIds } from "../helpers";
import { assertValidGameState } from "../invariants";

let state!: GameState;

beforeEach(() => {
    resetIds();
    state = createTestState();
});

describe("_cardsMoveToTrash", () => {
    it("moves ids from current zone to trash", () => {
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "HAND" });
        const c2 = makeCharacterInstance({ controller: "p1", currentZone: "HAND" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { hand: [c1.instanceId, c2.instanceId] },
        });

        const next = _cardsMoveToTrash(state, "p1", [c1.instanceId, c2.instanceId], "HAND", { kind: "RULE" });

        // ids removed from origin zone
        expect(next.playerZones["p1"].hand).toHaveLength(0);
        // ids pushed to trash
        expect(next.playerZones["p1"].trash).toContain(c1.instanceId);
        expect(next.playerZones["p1"].trash).toContain(c2.instanceId);
        assertValidGameState(next);
    });
    it("attempts to move id to trash when id does not exist in source", () => {
        // Validly in DECK, so a move whose source is HAND finds nothing there.
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "DECK" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1 }, {
            p1: { deck: [c1.instanceId] },
        });

        expect(() => _cardsMoveToTrash(state, "p1", [c1.instanceId], "HAND", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
    it("attempts to move DON to trash", () => {
        const don = makeDonInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [don.instanceId]: don }, {
            p1: { donDeck: [don.instanceId] },
        });

        expect(() => _cardsMoveToTrash(state, "p1", [don.instanceId], "DON_DECK", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
    it("attempts to move LEADER to trash", () => {
        // leaders cannot be removed from LEADER zone — place in hand to isolate the class guard
        const leader = makeLeaderInstance({ controller: "p1" });
        const leaderInHand = { ...leader, currentZone: "HAND" as const };
        state = createTestState(["p1", "p2"], { [leader.instanceId]: leaderInHand }, {
            p1: { hand: [leader.instanceId] },
        });

        expect(() => _cardsMoveToTrash(state, "p1", [leader.instanceId], "HAND", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
});

describe("sendTopDeckToTrash", () => {
    it("moves top card in deck to trash", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const topId = state.playerZones["p1"].deck[0];
        const next = sendTopDeckToTrash(state, "p1", 1, { kind: "RULE" });

        expect(next.playerZones["p1"].deck).not.toContain(topId);
        expect(next.playerZones["p1"].trash).toContain(topId);
        assertValidGameState(next);
    });
    it("moves top N cards in deck to trash", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        const c3 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2, [c3.instanceId]: c3 }, {
            p1: { deck: [c1.instanceId, c2.instanceId, c3.instanceId] },
        });

        const next = sendTopDeckToTrash(state, "p1", 3, { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        expect(next.playerZones["p1"].trash).toContain(c1.instanceId);
        expect(next.playerZones["p1"].trash).toContain(c2.instanceId);
        expect(next.playerZones["p1"].trash).toContain(c3.instanceId);
        assertValidGameState(next);
    });
    it("moves as many cards as possible to trash", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const next = sendTopDeckToTrash(state, "p1", 10, { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        expect(next.playerZones["p1"].trash).toContain(c1.instanceId);
        expect(next.playerZones["p1"].trash).toContain(c2.instanceId);
        assertValidGameState(next);
    });
    it("does nothing when deck is empty", () => {
        const next = sendTopDeckToTrash(state, "p1", 1, { kind: "RULE" });

        expect(next.playerZones["p1"].deck).toHaveLength(0);
        expect(next.playerZones["p1"].trash).toHaveLength(0);
        assertValidGameState(next);
    });
});

describe("sendTopLifeToTrash", () => {
    it("moves top life card to trash", () => {
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        const c2 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { life: [c1.instanceId, c2.instanceId] },
        });

        const topId = state.playerZones["p1"].life[0];
        const next = sendTopLifeToTrash(state, "p1", 1, { kind: "RULE" });

        expect(next.playerZones["p1"].life).not.toContain(topId);
        expect(next.playerZones["p1"].trash).toContain(topId);
        assertValidGameState(next);
    });
    it("moves top N life cards to trash", () => {
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        const c2 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { life: [c1.instanceId, c2.instanceId] },
        });

        const next = sendTopLifeToTrash(state, "p1", 2, { kind: "RULE" });

        expect(next.playerZones["p1"].life).toHaveLength(0);
        expect(next.playerZones["p1"].trash).toContain(c1.instanceId);
        expect(next.playerZones["p1"].trash).toContain(c2.instanceId);
        assertValidGameState(next);
    });
    it("does nothing when life is empty", () => {
        const next = sendTopLifeToTrash(state, "p1", 1, { kind: "RULE" });

        expect(next.playerZones["p1"].life).toHaveLength(0);
        expect(next.playerZones["p1"].trash).toHaveLength(0);
        assertValidGameState(next);
    });
});
