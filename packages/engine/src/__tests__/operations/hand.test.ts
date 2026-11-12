import { describe, it, expect, beforeEach } from "vitest";
import type { GameState } from "../../types/state";
import {
    _cardsMoveToHand,
    cardsDraw,
    sendLifeToHand,
} from "../../game/operations/zones/hand";
import { InvalidActionError } from "../../errors";
import { createTestState, makeCharacterInstance, makeDonInstance, makeLeaderInstance, resetIds } from "../helpers";
import { assertValidGameState } from "../invariants";

let state!: GameState;

beforeEach(() => {
    resetIds();
    state = createTestState();
});

describe("_cardsMoveToHand", () => {
    it("moves the ids from the current zone to the hand", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const next = _cardsMoveToHand(state, "p1", [c1.instanceId, c2.instanceId], "DECK", { kind: "RULE" });

        // ids removed from origin zone
        // ids added to hand
        expect(next.playerZones["p1"].hand).toContain(c1.instanceId);
        expect(next.playerZones["p1"].hand).toContain(c2.instanceId);
        // currentZone updated to hand for all instances
        assertValidGameState(next);
    });
    it("attempts to move id to hand when id does not exist in source", () => {
        // Validly in TRASH, so a move whose source is DECK finds nothing there.
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "TRASH" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1 }, {
            p1: { trash: [c1.instanceId] },
        });

        // throws if id not in source zone
        expect(() => _cardsMoveToHand(state, "p1", [c1.instanceId], "DECK", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
    it("attempts to move DON to hand", () => {
        const don = makeDonInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [don.instanceId]: don }, {
            p1: { donDeck: [don.instanceId] },
        });

        // throws when DON instance is moved
        expect(() => _cardsMoveToHand(state, "p1", [don.instanceId], "DON_DECK", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
    it("attempts to move LEADER to hand", () => {
        // leaders cannot be removed from LEADER zone — place in trash to isolate the class guard
        const leader = makeLeaderInstance({ controller: "p1" });
        const leaderInTrash = { ...leader, currentZone: "TRASH" as const };
        state = createTestState(["p1", "p2"], { [leader.instanceId]: leaderInTrash }, {
            p1: { trash: [leader.instanceId] },
        });

        // throws when LEADER instance is moved
        expect(() => _cardsMoveToHand(state, "p1", [leader.instanceId], "TRASH", { kind: "RULE" }))
            .toThrow(InvalidActionError);
    });
});

describe("cardsDraw", () => {
    it("moves the top card of the deck into the hand", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        // Keep the card instance id of the top card of the deck pre-draw
        const topId = state.playerZones["p1"].deck[0];
        const next = cardsDraw(state, "p1", 1, { kind: "RULE" });

        // Check that the card instance id does not exist in the deck
        // Check that the card instance id exists in hand
        expect(next.playerZones["p1"].hand).toContain(topId);
        // Check that the card's current zone was updated to "HAND"
        assertValidGameState(next);
    });
    it("moves the top n cards of the deck into the hand", () => {
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        const c3 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2, [c3.instanceId]: c3 }, {
            p1: { deck: [c1.instanceId, c2.instanceId, c3.instanceId] },
        });

        // Keep the array of card instance ids of the top N cards of the deck pre-draw
        const topIds = state.playerZones["p1"].deck.slice(0, 3);
        const next = cardsDraw(state, "p1", 3, { kind: "RULE" });

        for (const id of topIds) {
            // Check that the ids in the array do not exist in the deck
            // Check that the ids in the array exist in hand
            expect(next.playerZones["p1"].hand).toContain(id);
            // Check that the card's current zone was updated to "HAND"
        }
        // Check that the ids exist in the hand in order that they were added (always pushes to top or front of the array so check reverse order)
        expect(next.playerZones["p1"].hand).toEqual([...topIds].reverse());
        assertValidGameState(next);
    });
    it("draws as many cards as possible", () => {
        // Same checks as above
        const c1 = makeCharacterInstance({ controller: "p1" });
        const c2 = makeCharacterInstance({ controller: "p1" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { deck: [c1.instanceId, c2.instanceId] },
        });

        const deckIds = [...state.playerZones["p1"].deck];
        const next = cardsDraw(state, "p1", 10, { kind: "RULE" });

        // Check that deck is empty
        expect(next.playerZones["p1"].deck).toHaveLength(0);
        for (const id of deckIds) {
            // Check that the ids in the array exist in hand
            expect(next.playerZones["p1"].hand).toContain(id);
        }
        assertValidGameState(next);
    });
    it("does nothing when the deck is empty", () => {
        // Check draw 1, draw N
        // Verify that nothing changed between deck and hand
        const next1 = cardsDraw(state, "p1", 1, { kind: "RULE" });
        expect(next1.playerZones["p1"].deck).toHaveLength(0);
        expect(next1.playerZones["p1"].hand).toHaveLength(0);

        const next2 = cardsDraw(state, "p1", 5, { kind: "RULE" });
        expect(next2.playerZones["p1"].deck).toHaveLength(0);
        expect(next2.playerZones["p1"].hand).toHaveLength(0);
        assertValidGameState(next1);
        assertValidGameState(next2);
    });
});

describe("sendTrashToHand", () => {
    it.todo("Test determined irrelevant");
});

describe("sendLifeToHand", () => {
    it("takes top life", () => {
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        const c2 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { life: [c1.instanceId, c2.instanceId] },
        });

        const topId = state.playerZones["p1"].life[0];
        const next = sendLifeToHand(state, "p1", "TOP", { kind: "RULE" });

        // id at life top was removed
        // id of previous top life is in hand
        expect(next.playerZones["p1"].hand).toContain(topId);
        assertValidGameState(next);
    });
    it("takes bottom life", () => {
        const c1 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        const c2 = makeCharacterInstance({ controller: "p1", currentZone: "LIFE" });
        state = createTestState(["p1", "p2"], { [c1.instanceId]: c1, [c2.instanceId]: c2 }, {
            p1: { life: [c1.instanceId, c2.instanceId] },
        });

        const bottomId = state.playerZones["p1"].life.at(-1)!;
        const next = sendLifeToHand(state, "p1", "BOTTOM", { kind: "RULE" });

        // id at bottom life was removed
        // id of bottom life is in hand
        expect(next.playerZones["p1"].hand).toContain(bottomId);
        assertValidGameState(next);
    });
    it("does nothing if life empty", () => {
        // state and hand is unchanged after
        const next = sendLifeToHand(state, "p1", "TOP", { kind: "RULE" });

        expect(next.playerZones["p1"].life).toHaveLength(0);
        expect(next.playerZones["p1"].hand).toHaveLength(0);
        assertValidGameState(next);
    });
});
