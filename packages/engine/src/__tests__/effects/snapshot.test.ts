import { describe, it, expect, beforeEach } from "vitest";
import { produce } from "immer";
import { captureSnapshot } from "../../game/snapshot";
import { playCharacter, removeCardsFromField } from "../../game/operations/cards";
import { calculatePower } from "../../game/calculations";
import { attachDon } from "../../game/mechanics";
import { assertValidGameState } from "../invariants";
import {
    createTestState,
    makeCharacterInstance,
    makeDonInstance,
    makeEventInstance,
    makeLeaderInstance,
    placeCard,
    resetIds,
} from "../helpers";
import type { CardDef, CardInstance, GameState, PlayerId } from "../../types";

// captureSnapshot — the read that makes a subject survive its own mutation.
//
// Two things are being pinned here, and only the second is interesting:
//   1. That the fields are read off the right places (identity, zone, class gating).
//   2. LAST-KNOWN INFORMATION: that a snapshot taken before an operation still
//      reports what the operation destroyed. That is the entire reason the function
//      exists, so it is asserted against a REAL operation rather than a hand-built
//      state — a test that mutates state itself would prove nothing about whether
//      the capture sits early enough in the call.

const SELF: PlayerId = "p1";

beforeEach(() => {
    resetIds();
});

function stateWith(instances: CardInstance[], defs: Record<string, Partial<CardDef>> = {}): GameState {
    const definitions: Record<string, CardDef> = {};
    for (const [cardId, partial] of Object.entries(defs)) {
        definitions[cardId] = {
            id: cardId, name: cardId, class: "CHARACTER", colors: [], types: [],
            attributes: [], aliases: [], restrictions: [], ...partial,
        };
    }
    let state = createTestState([SELF, "p2"], {}, {}, definitions);
    for (const inst of instances) {
        state = placeCard(state, inst, inst.currentZone ?? "DECK", inst.controller);
    }
    assertValidGameState(state);
    return state;
}

// Attach through the real mechanic rather than by hand, so both sides of the link
// (the card's attachedDon, the DON's attachedTo and its null zone) stay consistent.
// Setup, not code under test — the DON is placed in DON_ACTIVE first, then lifted out.
function withAttachedDon(state: GameState, donId: string, targetId: string): GameState {
    state = attachDon(state, donId, targetId);
    assertValidGameState(state);
    return state;
}

describe("captureSnapshot", () => {
    it("carries identity and the zone the card was in at capture", () => {
        const c = makeCharacterInstance({ cardId: "OP01-001", currentZone: "CHARACTERS" });
        const state = stateWith([c], { "OP01-001": { power: 5000, cost: 4, counter: 1000 } });

        const snap = captureSnapshot(state, c.instanceId);

        expect(snap.instanceId).toBe(c.instanceId);
        expect(snap.cardId).toBe("OP01-001");
        expect(snap.class).toBe("CHARACTER");
        expect(snap.controller).toBe(SELF);
        expect(snap.zoneAtCapture).toBe("CHARACTERS");
    });

    it("nulls the stats a class does not have rather than throwing", () => {
        // The three calculate* helpers throw for a class with no such stat, so the
        // class gate in captureSnapshot is load-bearing: an event has cost but no
        // power and no counter.
        const e = makeEventInstance({ cardId: "OP01-EVENT", currentZone: "HAND" });
        const state = stateWith([e], { "OP01-EVENT": { class: "EVENT", cost: 2 } });

        const snap = captureSnapshot(state, e.instanceId);

        expect(snap.cost).toBe(2);
        expect(snap.power).toBeNull();
        expect(snap.counter).toBeNull();
    });

    it("captures DON without reaching for a definition", () => {
        // getCardDef THROWS for DON, and DON signals are constant traffic (DON_RESTED
        // fires on every cost payment), so this path has to be handled before the
        // lookup rather than guarded at the call sites.
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = stateWith([don]);

        const snap = captureSnapshot(state, don.instanceId);

        expect(snap.cardId).toBeNull();
        expect(snap.class).toBe("DON");
        expect(snap.zoneAtCapture).toBe("DON_ACTIVE");
        expect(snap.power).toBeNull();
    });

    it("keeps base and derived power apart when DON is attached", () => {
        const c = makeCharacterInstance({ cardId: "OP01-001", currentZone: "CHARACTERS" });
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        let state = stateWith([c, don], { "OP01-001": { power: 5000, cost: 4 } });
        state = withAttachedDon(state, don.instanceId, c.instanceId);
        state = produce(state, draft => { draft.turnPlayerId = SELF; });

        const snap = captureSnapshot(state, c.instanceId);

        expect(snap.basePower).toBe(5000);
        expect(snap.power).toBe(5001); // test DON is worth 1
        expect(snap.attachedDon).toEqual([don.instanceId]);
    });

    it("does not alias live state — the snapshot's attachedDon is a copy", () => {
        const c = makeCharacterInstance({ cardId: "OP01-001", currentZone: "CHARACTERS" });
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        let state = stateWith([c, don], { "OP01-001": { power: 5000, cost: 4 } });
        state = withAttachedDon(state, don.instanceId, c.instanceId);

        const snap = captureSnapshot(state, c.instanceId);

        expect(snap.attachedDon).not.toBe((state.instances[c.instanceId] as any).attachedDon);
        expect(snap.attachedDon).toEqual([don.instanceId]);
    });
});

describe("last-known information", () => {
    // THE POINT OF THE WHOLE CHANGE.
    //
    // _removeCardFromField detaches a card's DON before it moves the card, so by the
    // time anything downstream looks, the buffed power is gone from live state and is
    // not recoverable. A subject captured at the head of the operation still has it.
    it("a subject captured before removal still reports the power the card was K.O.'d at", () => {
        const c = makeCharacterInstance({ cardId: "OP01-001", currentZone: "CHARACTERS" });
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        let state = stateWith([c, don], { "OP01-001": { power: 5000, cost: 4 } });
        state = withAttachedDon(state, don.instanceId, c.instanceId);
        state = produce(state, draft => { draft.turnPlayerId = SELF; });

        expect(calculatePower(state, c.instanceId)).toBe(5001);

        const after = removeCardsFromField(state, SELF, [c.instanceId], "KO", "TOP", { kind: "RULE" });

        // Live state has lost it: the DON is detached and the card is in the trash.
        expect(calculatePower(after, c.instanceId)).toBe(5000);
        expect(after.instances[c.instanceId].currentZone).toBe("TRASH");

        // The signal that reported the removal still carries the card as it was.
        const removal = after.gameLog.find(
            entry => entry.kind === "SIGNAL" && entry.signal.type === "CARD_REMOVED_FROM_FIELD",
        );
        expect(removal).toBeDefined();
        const subject = (removal as any).signal.subjects[0];
        expect(subject.instanceId).toBe(c.instanceId);
        expect(subject.power).toBe(5001);
        expect(subject.zoneAtCapture).toBe("CHARACTERS");
        expect(subject.attachedDon).toEqual([don.instanceId]);
    });

    // The same capture feeds the CARDS_SENT_TO_TRASH that follows, because both
    // signals describe one departure. Emitted AFTER the move, and still pre-mutation
    // data — which is exactly the decoupling of capture from emit.
    it("reuses the pre-mutation capture for the trash signal emitted after the move", () => {
        const c = makeCharacterInstance({ cardId: "OP01-001", currentZone: "CHARACTERS" });
        let state = stateWith([c], { "OP01-001": { power: 5000, cost: 4 } });
        state = produce(state, draft => { draft.turnPlayerId = SELF; });

        const after = removeCardsFromField(state, SELF, [c.instanceId], "KO", "TOP", { kind: "RULE" });

        const trashed = after.gameLog.find(
            entry => entry.kind === "SIGNAL" && entry.signal.type === "CARDS_SENT_TO_TRASH",
        );
        expect(trashed).toBeDefined();
        expect((trashed as any).signal.subjects[0].zoneAtCapture).toBe("CHARACTERS");
    });

    // An entry signal is captured pre-mutation too — one rule, no entry/exit split.
    // On-Play effects are unaffected because the activeZone gate reads the LISTENER's
    // live zone, never the subject's captured one.
    it("captures a played character in the zone it came from, not the one it lands in", () => {
        const leader = makeLeaderInstance({ controller: SELF, cardId: "OP01-LEADER" });
        const c = makeCharacterInstance({ cardId: "OP01-001", currentZone: "HAND" });
        let state = stateWith([leader, c], {
            "OP01-001": { power: 5000, cost: 0 },
            "OP01-LEADER": { class: "LEADER", power: 5000 },
        });
        state = produce(state, draft => { draft.turnPlayerId = SELF; });

        const after = playCharacter(state, SELF, c.instanceId, { kind: "PLAYER" });

        const played = after.gameLog.find(
            entry => entry.kind === "SIGNAL" && entry.signal.type === "CHARACTER_PLAYED",
        );
        expect(played).toBeDefined();
        expect((played as any).signal.subjects[0].zoneAtCapture).toBe("HAND");
        // ...while the card itself has landed.
        expect(after.instances[c.instanceId].currentZone).toBe("CHARACTERS");
    });
});