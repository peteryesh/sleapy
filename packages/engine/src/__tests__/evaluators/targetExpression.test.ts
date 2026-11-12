import { describe, it, expect, beforeEach } from "vitest";
import { evalTargetExpression } from "../../evaluator";
import {
    CONTROLLED_BY_OPPONENT,
    CONTROLLED_BY_SELF,
    cardsLimit,
    makeEvalContext,
    makeTargetingBoard,
    playerChoice,
    resetIds,
    selector,
    selfTarget,
    sortedIds,
    weightedLimit,
} from "../helpers";

// evalTargetExpression on its own: given this board and this expression, which cards
// are CANDIDATES? Legality of a pick (limits, the running selection) and the prompt
// loop live in effects/target.test.ts. Fixtures are the targeting section of
// helpers.ts.
//
// Filter semantics are NOT re-tested here (see cardFilter.test.ts). Filters appear
// only to prove they are wired in: one matching / non-matching pair, preferably with a
// context-dependent filter (CONTROLLER) so the EvalContext is exercised too.

beforeEach(() => {
    resetIds();
});

describe("SELF_TARGET", () => {
    it("returns the owner of the effect", () => {
        const board = makeTargetingBoard();

        const targets = evalTargetExpression(board.state, makeEvalContext(board.source), selfTarget());

        expect(targets).toEqual([board.source]);
    });
});

// The HAND card in makeTargetingBoard is the zone control for every field-targeting case
// below: it would match any filter used here, so its absence proves `zones` is read.

describe("SELECTOR_TARGET", () => {
    it("returns all cards (no filter)", () => {
        const board = makeTargetingBoard();

        const targets = evalTargetExpression(board.state, makeEvalContext(board.source), selector(["CHARACTERS"]));

        expect(sortedIds(targets)).toEqual(sortedIds([
            board.source, board.selfLow, board.selfMid, board.oppLow, board.oppHigh,
        ]));
    });

    it("returns all cards that fit filter", () => {
        const board = makeTargetingBoard();

        const targets = evalTargetExpression(
            board.state, makeEvalContext(board.source), selector(["CHARACTERS"], CONTROLLED_BY_OPPONENT));

        expect(sortedIds(targets)).toEqual(sortedIds([board.oppLow, board.oppHigh]));
    });
});

// evalTargetExpression lists CANDIDATES. Limits and the running selection belong to
// isValidSelection, so every expression here carries limits that would reject most of
// the board (one card, cost 1 or less) — and every candidate still comes back.
describe("PLAYER_CHOICE_TARGET", () => {
    const restrictiveLimits = () => [cardsLimit(1), weightedLimit("COST", 1)];

    it("returns all cards (no filter)", () => {
        const board = makeTargetingBoard();

        const targets = evalTargetExpression(
            board.state, makeEvalContext(board.source), playerChoice(["CHARACTERS"], restrictiveLimits()));

        expect(sortedIds(targets)).toEqual(sortedIds([
            board.source, board.selfLow, board.selfMid, board.oppLow, board.oppHigh,
        ]));
    });

    it("returns all cards that fit filter", () => {
        const board = makeTargetingBoard();

        const targets = evalTargetExpression(
            board.state,
            makeEvalContext(board.source),
            playerChoice(["CHARACTERS"], restrictiveLimits(), { filter: CONTROLLED_BY_SELF }),
        );

        expect(sortedIds(targets)).toEqual(sortedIds([board.source, board.selfLow, board.selfMid]));
    });
});

