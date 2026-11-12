import { describe, it, expect, beforeEach } from "vitest";
import { produce } from "immer";
import { evalCardFilter } from "../../evaluator";
import { captureSnapshot } from "../../game/snapshot";
import type {
    EvalContext,
    GameState,
    CardDef,
    CardInstance,
    CharacterInstance,
    CardInstanceId,
    PlayerId,
} from "../../types";
import {
    createTestState,
    makeCharacterInstance,
    makeDonInstance,
    makeLeaderInstance,
    makeEventInstance,
    makeStageInstance,
    resetIds,
    zonesFromInstances,
} from "../helpers";

const SELF: PlayerId = "p1";
const OPP: PlayerId = "p2";

beforeEach(() => {
    resetIds();
});

// Build a state from raw instances plus optional partial defs (keyed by cardId).
// Any non-DON instance without a supplied def gets a minimal one fabricated by createTestState.
function buildState(instances: CardInstance[], defs: Record<string, Partial<CardDef>> = {}): GameState {
    const instanceMap: Record<CardInstanceId, CardInstance> = {};
    for (const inst of instances) instanceMap[inst.instanceId] = inst;

    const definitions: Record<string, CardDef> = {};
    for (const [cardId, partial] of Object.entries(defs)) {
        definitions[cardId] = {
            id: cardId,
            name: cardId,
            class: "CHARACTER",
            colors: [],
            types: [],
            attributes: [],
            aliases: [],
            restrictions: [],
            ...partial,
        };
    }
    return createTestState([SELF, OPP], instanceMap, zonesFromInstances(instances), definitions);
}

// A character instance with arbitrary field overrides (flipped, isRested, controller, zone, ...).
function char(overrides: Partial<CharacterInstance> = {}): CharacterInstance {
    return { ...(makeCharacterInstance() as CharacterInstance), ...overrides };
}

// A single character wired to a controlled def — the common case for value-based filters.
function singleChar(def: Partial<CardDef> = {}): { state: GameState; id: CardInstanceId } {
    const inst = char({ cardId: "card-under-test" });
    const state = buildState([inst], { "card-under-test": def });
    return { state, id: inst.instanceId };
}

function ctx(source: CardInstanceId = "source", self: PlayerId = SELF): EvalContext {
    return { self, source };
}

describe("any", () => {
    it("should return true for any card", () => {
        const c = char();
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([c, don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "ANY" })).toBe(true);
        // works for DON too — ANY reads nothing from the def
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "ANY" })).toBe(true);
    });
});

describe("this", () => {
    it("should return true only for the evaluated card", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(c.instanceId), captureSnapshot(state, c.instanceId), { kind: "THIS" })).toBe(true);
    });
    it("should return false for other cards", () => {
        const c = char();
        const other = char();
        const state = buildState([c, other]);
        expect(evalCardFilter(state, ctx(other.instanceId), captureSnapshot(state, c.instanceId), { kind: "THIS" })).toBe(false);
    });
    it("should throw an error if no context is provided", () => {
        const c = char();
        const state = buildState([c]);
        expect(() =>
            evalCardFilter(state, undefined as unknown as EvalContext, captureSnapshot(state, c.instanceId), { kind: "THIS" }),
        ).toThrow();
    });
});

describe("controller", () => {
    it("should return true for cards controlled by self when controller is 'SELF'", () => {
        const c = char({ controller: SELF });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CONTROLLER", controller: "SELF" })).toBe(true);
    });
    it("should return false for cards controlled by other players when controller is 'SELF'", () => {
        const c = char({ controller: OPP });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CONTROLLER", controller: "SELF" })).toBe(false);
    });
    it("should return true for cards controlled by other players when controller is 'OPPONENT'", () => {
        const c = char({ controller: OPP });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CONTROLLER", controller: "OPPONENT" })).toBe(true);
    });
    it("should return false for cards controlled by self when controller is 'OPPONENT'", () => {
        const c = char({ controller: SELF });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CONTROLLER", controller: "OPPONENT" })).toBe(false);
    });
    it("should return true for cards controlled by any player when controller is 'ANY'", () => {
        const c = char({ controller: OPP });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CONTROLLER", controller: "ANY" })).toBe(true);
    });
});

describe("name", () => {
    it("should return true for cards with the specified name", () => {
        const { state, id } = singleChar({ name: "Luffy", aliases: ["Straw Hat Luffy"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "NAME", name: "Luffy" })).toBe(true);
        // also matches an alias
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "NAME", name: "Straw Hat Luffy" })).toBe(true);
    });
    it("should return false for cards with a different name", () => {
        const { state, id } = singleChar({ name: "Luffy" });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "NAME", name: "Zoro" })).toBe(false);
    });
    it("should return false for DON cards", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "NAME", name: "Luffy" })).toBe(false);
    });
});

describe("class", () => {
    it("should return true for cards with the specified class", () => {
        const c = char();
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([c, don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CLASS", cardClass: "CHARACTER" })).toBe(true);
        // DON matches CLASS:DON — class is read from the instance
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "CLASS", cardClass: "DON" })).toBe(true);
    });
    it("should return false for cards with a different class", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "CLASS", cardClass: "EVENT" })).toBe(false);
    });
    it("should return false for DON cards", () => {
        // a DON queried against a non-DON class
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "CLASS", cardClass: "CHARACTER" })).toBe(false);
    });
});

describe("cost", () => {
    it("should return false if the kind is COST and the card is a DON card", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "COST", op: ">=", value: 1 })).toBe(false);
    });
    it("should return false if the kind is COST and the card is a LEADER card", () => {
        const leader = makeLeaderInstance();
        const state = buildState([leader]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, leader.instanceId), { kind: "COST", op: ">=", value: 1 })).toBe(false);
    });
    it("should read the card's own cost value (not power or counter)", () => {
        const { state, id } = singleChar({ cost: 1, power: 2, counter: 3 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "==", value: 1 })).toBe(true);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "==", value: 2 })).toBe(false);
    });
});

describe("power", () => {
    it("should return false if the kind is POWER and the card is a DON card", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "POWER", op: ">=", value: 1 })).toBe(false);
    });
    it("should return false if the kind is POWER and the card is an EVENT card", () => {
        const event = makeEventInstance();
        const state = buildState([event]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, event.instanceId), { kind: "POWER", op: ">=", value: 1 })).toBe(false);
    });
    it("should return false if the kind is POWER and the card is a STAGE card", () => {
        const stage = makeStageInstance();
        const state = buildState([stage]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, stage.instanceId), { kind: "POWER", op: ">=", value: 1 })).toBe(false);
    });
    it("should read the card's own power value (not cost or counter)", () => {
        const { state, id } = singleChar({ cost: 1, power: 2, counter: 3 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "POWER", op: "==", value: 2 })).toBe(true);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "POWER", op: "==", value: 1 })).toBe(false);
    });
});

describe("counter", () => {
    it("should return false if the kind is COUNTER and the card is not a CHARACTER card", () => {
        const leader = makeLeaderInstance();
        const event = makeEventInstance();
        const state = buildState([leader, event]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, leader.instanceId), { kind: "COUNTER", op: ">=", value: 1 })).toBe(false);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, event.instanceId), { kind: "COUNTER", op: ">=", value: 1 })).toBe(false);
    });
    it("should read the card's own counter value (not cost or power)", () => {
        const { state, id } = singleChar({ cost: 1, power: 2, counter: 3 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COUNTER", op: "==", value: 3 })).toBe(true);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COUNTER", op: "==", value: 2 })).toBe(false);
    });
});

// Operator matrix — the shared comparator, exercised once via COST (cost = 5).
describe(">=", () => {
    it("should return true when value is greater than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: ">=", value: 3 })).toBe(true);
    });
    it("should return true when value is equal to the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: ">=", value: 5 })).toBe(true);
    });
    it("should return false when value is less than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: ">=", value: 7 })).toBe(false);
    });
});
describe(">", () => {
    it("should return true when value is greater than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: ">", value: 3 })).toBe(true);
    });
    it("should return false when value is less than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: ">", value: 7 })).toBe(false);
    });
    it("should return false when value is equal to the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: ">", value: 5 })).toBe(false);
    });
});
describe("<=", () => {
    it("should return true when value is less than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "<=", value: 7 })).toBe(true);
    });
    it("should return true when value is equal to the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "<=", value: 5 })).toBe(true);
    });
    it("should return false when value is greater than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "<=", value: 3 })).toBe(false);
    });
});
describe("<", () => {
    it("should return true when value is less than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "<", value: 7 })).toBe(true);
    });
    it("should return false when value is greater than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "<", value: 3 })).toBe(false);
    });
    it("should return false when value is equal to the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "<", value: 5 })).toBe(false);
    });
});
describe("=", () => {
    it("should return true when value is equal to the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "==", value: 5 })).toBe(true);
    });
    it("should return false when value is greater than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "==", value: 3 })).toBe(false);
    });
    it("should return false when value is less than the specified value", () => {
        const { state, id } = singleChar({ cost: 5 });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COST", op: "==", value: 7 })).toBe(false);
    });
});

// base vs current can only diverge once stat modifications exist — deferred until then.
it.todo("base cost");
it.todo("base power");
it.todo("base counter");

describe("color", () => {
    it("should return true for cards with the specified color", () => {
        const { state, id } = singleChar({ colors: ["RED"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COLOR", color: "RED" })).toBe(true);
    });
    it("should return true for cards with the specified color among multiple colors", () => {
        const { state, id } = singleChar({ colors: ["RED", "GREEN"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COLOR", color: "GREEN" })).toBe(true);
    });
    it("should return false for cards with a different color", () => {
        const { state, id } = singleChar({ colors: ["RED"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "COLOR", color: "BLUE" })).toBe(false);
    });

    it("should return false for DON cards", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "COLOR", color: "RED" })).toBe(false);
    });
});

describe("type", () => {
    it("should return true for cards with the specified type", () => {
        const { state, id } = singleChar({ types: ["Straw Hat Crew"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "TYPE", cardType: "Straw Hat Crew" })).toBe(true);
    });
    it("should return true for cards with the specified type among multiple types", () => {
        const { state, id } = singleChar({ types: ["Straw Hat Crew", "Supernovas"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "TYPE", cardType: "Supernovas" })).toBe(true);
    });
    it("should return false for cards with a different type", () => {
        const { state, id } = singleChar({ types: ["Straw Hat Crew"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "TYPE", cardType: "Navy" })).toBe(false);
    });

    it("should return false for DON cards", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "TYPE", cardType: "Straw Hat Crew" })).toBe(false);
    });
});

describe("attribute", () => {
    it("should return true for cards with the specified attribute", () => {
        const { state, id } = singleChar({ attributes: ["SLASH"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "ATTRIBUTE", attribute: "SLASH" })).toBe(true);
    });
    it("should return true for cards with the specified attribute among multiple attributes", () => {
        const { state, id } = singleChar({ attributes: ["SLASH", "STRIKE"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "ATTRIBUTE", attribute: "STRIKE" })).toBe(true);
    });
    it("should return false for cards with a different attribute", () => {
        const { state, id } = singleChar({ attributes: ["SLASH"] });
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, id), { kind: "ATTRIBUTE", attribute: "RANGED" })).toBe(false);
    });

    it("should return false for DON cards", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "ATTRIBUTE", attribute: "SLASH" })).toBe(false);
    });
});

describe("playable card rested", () => {
    it("should return true for cards that are rested when isRested is true", () => {
        const c = char({ isRested: true });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "RESTED", isRested: true })).toBe(true);
    });
    it("should return false for cards that are not rested when isRested is true", () => {
        const c = char({ isRested: false });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "RESTED", isRested: true })).toBe(false);
    });
    it("should return true for cards that are not rested when isRested is false", () => {
        const c = char({ isRested: false });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "RESTED", isRested: false })).toBe(true);
    });
    it("should return false for cards that are rested when isRested is false", () => {
        const c = char({ isRested: true });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "RESTED", isRested: false })).toBe(false);
    });
});

describe("don rested", () => {
    it("should return true for DON cards that are in the rested zone when isRested is true", () => {
        const don = makeDonInstance({ currentZone: "DON_RESTED" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "RESTED", isRested: true })).toBe(true);
    });
    it("should return false for DON cards that are not in the rested zone when isRested is true", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "RESTED", isRested: true })).toBe(false);
    });
    it("should return true for DON cards that are not in the rested zone when isRested is false", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "RESTED", isRested: false })).toBe(true);
    });
    it("should return false for DON cards that are in the rested zone when isRested is false", () => {
        const don = makeDonInstance({ currentZone: "DON_RESTED" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "RESTED", isRested: false })).toBe(false);
    });
});

describe("deck card flipped in life", () => {
    // All tests are for cards in the life zone, since flipped only matters there
    it("should return true for cards that are flipped when isFlipped is true", () => {
        const c = char({ currentZone: "LIFE", flipped: true });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "FLIPPED", isFlipped: true })).toBe(true);
    });
    it("should return false for cards that are not flipped when isFlipped is true", () => {
        const c = char({ currentZone: "LIFE", flipped: false });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "FLIPPED", isFlipped: true })).toBe(false);
    });
    it("should return true for cards that are not flipped when isFlipped is false", () => {
        const c = char({ currentZone: "LIFE", flipped: false });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "FLIPPED", isFlipped: false })).toBe(true);
    });
    it("should return false for cards that are flipped when isFlipped is false", () => {
        const c = char({ currentZone: "LIFE", flipped: true });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "FLIPPED", isFlipped: false })).toBe(false);
    });

    it("should return false for a flipped card outside the life zone (rule only applies in life)", () => {
        const c = char({ currentZone: "CHARACTERS", flipped: true });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "FLIPPED", isFlipped: true })).toBe(false);
    });

    it("should return false for DON cards regardless of isFlipped value", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "FLIPPED", isFlipped: true })).toBe(false);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, don.instanceId), { kind: "FLIPPED", isFlipped: false })).toBe(false);
    });
    it("should return false for LEADER cards regardless of isFlipped value", () => {
        const leader = makeLeaderInstance();
        const state = buildState([leader]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, leader.instanceId), { kind: "FLIPPED", isFlipped: true })).toBe(false);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, leader.instanceId), { kind: "FLIPPED", isFlipped: false })).toBe(false);
    });
});

describe("and", () => {
    it("should return true when all filters are true", () => {
        const c = char({ controller: SELF });
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), {
            kind: "AND",
            filters: [
                { kind: "CLASS", cardClass: "CHARACTER" },
                { kind: "CONTROLLER", controller: "SELF" },
            ],
        })).toBe(true);
    });
    it("should return false when any filter is false", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), {
            kind: "AND",
            filters: [
                { kind: "ANY" },
                { kind: "CLASS", cardClass: "EVENT" },
            ],
        })).toBe(false);
    });
    it("should return true if empty filters array is provided", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "AND", filters: [] })).toBe(true);
    });
});

describe("or", () => {
    it("should return true when any filter is true", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), {
            kind: "OR",
            filters: [
                { kind: "CLASS", cardClass: "EVENT" },
                { kind: "ANY" },
            ],
        })).toBe(true);
    });
    it("should return false when all filters are false", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), {
            kind: "OR",
            filters: [
                { kind: "CLASS", cardClass: "EVENT" },
                { kind: "CLASS", cardClass: "STAGE" },
            ],
        })).toBe(false);
    });
    it("should return false if empty filters array is provided", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), { kind: "OR", filters: [] })).toBe(false);
    });
});

describe("not", () => {
    it("should return true when the filter is false", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), {
            kind: "NOT", filter: { kind: "CLASS", cardClass: "EVENT" },
        })).toBe(true);
    });
    it("should return false when the filter is true", () => {
        const c = char();
        const state = buildState([c]);
        expect(evalCardFilter(state, ctx(), captureSnapshot(state, c.instanceId), {
            kind: "NOT", filter: { kind: "ANY" },
        })).toBe(false);
    });
});

describe("computed vs base stats", () => {
    // THE DISTINCTION THE SPLIT EXISTS FOR. Every other fixture in this file has no DON
    // attached, so base and computed coincide and a stat filter passes whichever field
    // it reads — which is precisely how the old `base` flag stayed wrong without a
    // single test failing.
    function charWithDon(): { state: GameState; id: CardInstanceId } {
        const c = char({ cardId: "card-under-test", currentZone: "CHARACTERS" });
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const base = buildState([c, don], { "card-under-test": { power: 5000, cost: 4 } });
        // calculatePower only counts attached DON for the turn player.
        const state = produce(base, draft => {
            (draft.instances[c.instanceId] as CharacterInstance).attachedDon = [don.instanceId];
            draft.instances[don.instanceId].currentZone = null;
            draft.turnPlayerId = SELF;
        });
        return { state, id: c.instanceId };
    }

    it("POWER reads the computed value, including attached DON", () => {
        const { state, id } = charWithDon();
        const snap = captureSnapshot(state, id);

        expect(evalCardFilter(state, ctx(), snap, { kind: "POWER", op: "==", value: 5001 })).toBe(true);
        expect(evalCardFilter(state, ctx(), snap, { kind: "POWER", op: "==", value: 5000 })).toBe(false);
    });

    it("BASE_POWER reads the printed value, ignoring attached DON", () => {
        const { state, id } = charWithDon();
        const snap = captureSnapshot(state, id);

        expect(evalCardFilter(state, ctx(), snap, { kind: "BASE_POWER", op: "==", value: 5000 })).toBe(true);
        expect(evalCardFilter(state, ctx(), snap, { kind: "BASE_POWER", op: "==", value: 5001 })).toBe(false);
    });

    // The pair a real card would use: "K.O. 1 Character with 5000 power or less" must
    // fail against a buffed 5001 character, while a base-costed filter is unaffected.
    it("the two disagree on the same card", () => {
        const { state, id } = charWithDon();
        const snap = captureSnapshot(state, id);

        expect(evalCardFilter(state, ctx(), snap, { kind: "POWER", op: "<=", value: 5000 })).toBe(false);
        expect(evalCardFilter(state, ctx(), snap, { kind: "BASE_POWER", op: "<=", value: 5000 })).toBe(true);
    });

    it("a stat the class does not have never matches, either form", () => {
        const don = makeDonInstance({ currentZone: "DON_ACTIVE" });
        const state = buildState([don]);
        const snap = captureSnapshot(state, don.instanceId);

        expect(evalCardFilter(state, ctx(), snap, { kind: "POWER", op: ">=", value: 0 })).toBe(false);
        expect(evalCardFilter(state, ctx(), snap, { kind: "BASE_POWER", op: ">=", value: 0 })).toBe(false);
        expect(evalCardFilter(state, ctx(), snap, { kind: "COUNTER", op: ">=", value: 0 })).toBe(false);
    });
});
