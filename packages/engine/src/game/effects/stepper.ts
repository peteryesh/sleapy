import type { GameState } from "../../types";
import { advanceEffectCursor, clearCurrentEffect, clearSelectedTargets } from "../mechanics";
import { executeResolution } from "./resolution";

// The program counter for a promoted effect. Runs the step at the cursor, moves
// past it, and clears currentEffect once the list is exhausted.
//
// ONE STEP PER CALL. `advance` already loops to a fixed point, so draining the
// list here would duplicate that loop and hide the mid-effect pauses a PAYMENT
// step will need in order to raise a decisionPoint.
//
// It owns the counter and the terminal condition only. What a step actually does
// belongs to executeResolution, which never sees the cursor.
export function advanceEffect(state: GameState): GameState {
    const effectContext = state.currentEffect;
    if (!effectContext) throw new Error(`advanceEffect called with no current effect`);

    // An effect with no steps at all, or one already parked past its last step.
    if (effectContext.cursor >= effectContext.steps.length) {
        return clearCurrentEffect(state);
    }

    const step = effectContext.steps[effectContext.cursor];
    switch (step.kind) {
        case "RESOLUTION":
            state = executeResolution(state, effectContext, step.operation);
            break;
        // Real step kinds with no implementation yet. Skipping them silently
        // would make a half-built effect look like it resolved correctly.
        case "PAYMENT":
        case "REQUIREMENT":
            throw new Error(`Effect step kind ${step.kind} is not yet implemented`);
        default:
            throw new Error(`Unknown effect step kind: ${(step as any).kind}`);
    }

    if (state.decisionPoint) {
        return state;
    }
    state = advanceEffectCursor(state);
    state = clearSelectedTargets(state);

    // The call that runs the last step is also the call that terminates — no
    // extra round trip through the conductor just to notice the list ran out.
    const advanced = state.currentEffect;
    if (!advanced || advanced.cursor >= advanced.steps.length) {
        return clearCurrentEffect(state);
    }
    return state;
}
