import { EffectId } from "./effect";
import { CardInstanceId, PlayerId } from "./primitives";

export type GameAction =
    // Setup
    | { type: "CHOOSE_FIRST_PLAYER"; playerId: PlayerId; choice: PlayerId}
    | { type: "KEEP_HAND"; playerId: PlayerId }
    | { type: "MULLIGAN"; playerId: PlayerId }

    // Game Flow
    | { type: "NEXT_PHASE"; playerId: PlayerId }

    // Main Phase
    | { type: "PLAY_CARD"; playerId: PlayerId; instanceId: CardInstanceId; }
    | { type: "DISPLACE_ON_FIELD"; playerId: PlayerId; displacedId: CardInstanceId }
    | { type: "ATTACH_DON"; playerId: PlayerId; targetId: CardInstanceId; count: number }
    | { type: "ACTIVATE_EFFECT"; playerId: PlayerId; instanceId: CardInstanceId; effectId: EffectId }
    // Combat
    | { type: "DECLARE_ATTACK"; playerId: PlayerId; attackerId: CardInstanceId; defenderId: CardInstanceId }
    | { type: "DECLARE_BLOCKER"; playerId: PlayerId; blockerId: CardInstanceId }
    | { type: "PLAY_COUNTER"; playerId: PlayerId; counterId: CardInstanceId }
    | { type: "COMPLETE_BATTLE"; playerId: PlayerId }

    // Effect Resolutions
    | { type: "ACTIVATE_TRIGGER"; playerId: PlayerId; instanceId: CardInstanceId; activate: boolean }
    | { type: "SUBMIT_REORDER"; playerId: PlayerId; orderedInstanceIds: CardInstanceId[] }
    // `index` is the position in the player's array of the CURRENT effect frame, and
    // it is the actual key — `(instanceId, effectId)` is not unique. One effect can
    // stage twice in a single frame when it listens for two signals that both fire
    // during one action (playEvent emits CARDS_SENT_TO_TRASH then EVENT_PLAYED), and
    // those two contexts carry DIFFERENT subjects, so they do not resolve identically.
    // Without the index the player cannot reach the second one.
    //
    // The ids are kept alongside it deliberately: they make a stale index a loud
    // rejection instead of a silent wrong pick.
    | { type: "CHOOSE_NEXT_EFFECT"; playerId: PlayerId; index: number; instanceId: CardInstanceId; effectId: EffectId }
    | { type: "CHOOSE_TARGET"; playerId: PlayerId; instanceId: CardInstanceId }