import { evalAmountExpression, evalCardFilter } from "../../evaluator";
import { CardInstanceId, CardSnapshot, CardStatType, EffectOperation, EvalContext, GameState, TargetExpression, TargetLimit } from "../../types/";
import { captureSnapshot } from "../snapshot";

export function isValidSelection(state: GameState, evalContext: EvalContext, expression: TargetExpression, targetId: CardInstanceId): boolean {
    if (expression.kind !== "PLAYER_CHOICE_TARGET" && expression.kind !== "SELECTOR_TARGET") {
        throw new Error(`isValidSelection only supports PLAYER_CHOICE_TARGET and SELECTOR_TARGET constraints`);
    }
    if (state.currentEffect === null || state.currentEffect === undefined) {
        throw new Error(`No current effect found on the state`);
    }
    if (state.currentEffect.selected !== null && state.currentEffect.selected.includes(targetId)) {
        return false;
    }
    const targetSnapshot = captureSnapshot(state, targetId);
    // Check if the target is in one of the specified zones
    if (!expression.zones.includes(targetSnapshot.zoneAtCapture!)) {
        return false;
    }
    // Check if the target passes the filter
    if (!evalCardFilter(state, evalContext, targetSnapshot, expression.filter ?? { kind: "ANY" })) {
        return false;
    }
    if (expression.kind === "PLAYER_CHOICE_TARGET") {
        for (const limit of expression.limits) {
            if (!isWithinEffectTargetLimit(state, evalContext, limit, targetSnapshot)) {
                return false;
            }
        }
    }
    return true;
}

export function isWithinEffectTargetLimit(state: GameState, evalContext: EvalContext, limit: TargetLimit, target: CardSnapshot): boolean {
    let targetWeightValue = 1;
    if (limit.kind === "WEIGHTED") {
        targetWeightValue = getStatFromLimitWeight(target, limit.weight);
    }
    const capacity = evalAmountExpression(state, evalContext, limit.capacity)
    if (targetWeightValue > capacity) {
        return false;
    }
    return true;
}

export function getStatFromLimitWeight(target: CardSnapshot, weight: CardStatType): number {
    let targetWeightValue: number | null = null;
    switch (weight) {
        case "COST":
            targetWeightValue = target.cost;
            break;
        case "BASE_COST":
            targetWeightValue = target.baseCost;
            break;
        case "POWER":
            targetWeightValue = target.power;
            break;
        case "BASE_POWER":
            targetWeightValue = target.basePower;
            break;
        case "COUNTER":
            targetWeightValue = target.counter;
            break;
        case "BASE_COUNTER":
            targetWeightValue = target.baseCounter;
            break;
        default:
            throw new Error(`Unknown weight type: ${weight}`);
    }
    if (targetWeightValue === null || targetWeightValue === undefined) {
        throw new Error(`Target ${target.instanceId} has ${weight} null or undefined, cannot evaluate against weight ${weight}`);
    }
    return targetWeightValue;
}

export function decrementCapacity(state: GameState, targetId: CardInstanceId, limit: TargetLimit): TargetLimit {
    if (limit.capacity.kind !== "LITERAL") {
        throw Error(`Only literals allowed on effect target defintions for now`);
    }
    switch (limit.kind) {
        case "CARDS":
            limit.capacity.value -= 1;
            break;
        case "WEIGHTED":
            const weightedValue = getStatFromLimitWeight(captureSnapshot(state, targetId), limit.weight);
            limit.capacity.value -= weightedValue;
            break;
        default:
            throw Error(`Unknown limit kind`);
    }
    if (limit.capacity.value < 0) {
        throw Error (`Limit has gone negative`);
    }
    return limit;
}

export function targetOf(operation: EffectOperation): TargetExpression | null {
    return "target" in operation && operation.target ? operation.target : null;
}