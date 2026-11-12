import type { CardId, CardInstanceId, Attribute, CardClass, Color, PlayerId, Zone } from './primitives';
import { EffectDef, EffectId, StatusEffectDef } from './effect';

export interface Card {
    id: CardId;
    set_id: string;
    name: string;
    class: CardClass;
    rarity: string;
    block: number;
    cost?: number;
    power?: number;
    counter?: number;
    life?: number;
    raw_effect?: string;
    artist?: string;
    colors: Color[];
    types: string[];
    attributes: Attribute[];
    alts: object[];
    aliases: string[];
    restrictions: object[];
}

// Engine-specific shape — derived from Card, omits display-only fields
export interface CardDef {
    id: CardId;
    name: string;
    class: CardClass;
    cost?: number;
    power?: number;
    counter?: number;
    life?: number;
    colors: Color[];
    types: string[];
    attributes: Attribute[];
    aliases: string[];
    restrictions: object[];
    effectDefs?: Record<EffectId, EffectDef>;   // added later, not in database currently
    statusEffectDefs?: StatusEffectDef[];
}

export type DeckList = {
    leader: CardId;
    deck: CardId[];
    sideDeck: CardId[];
    donCount: number;
}

export interface BaseCardInstance {
    instanceId: CardInstanceId;
    controller: PlayerId;
    currentZone: Zone | null;
    isRested: boolean;
}

// Leader — like character but tracks life and has rule modifiers
export interface LeaderInstance extends BaseCardInstance {
    cardId: CardId;
    class: "LEADER";
    attachedDon: CardInstanceId[];
}

// Character — can attack, have DON!! attached, use effects
export interface CharacterInstance extends BaseCardInstance {
    cardId: CardId;
    class: "CHARACTER";
    attachedDon: CardInstanceId[];
    playedOnTurns: number[];
    flipped: boolean;
}

// Stage — enters play, can be bounced, no DON!!
export interface StageInstance extends BaseCardInstance {
    cardId: CardId;
    class: "STAGE";
    attachedDon: CardInstanceId[];
    playedOnTurns: number[];
    flipped: boolean;
}

export interface EventInstance extends BaseCardInstance {
    cardId: CardId;
    class: "EVENT";
    playedOnTurns: number[];
    flipped: boolean;
}

// DON!! — attaches to characters/leader, tracks attachment
// isRested reflects zone: true in DON_RESTED, false in DON_ACTIVE or DON_DECK; unchanged while attached
export interface DonInstance extends BaseCardInstance {
    class: "DON";
    isRested: boolean;
    attachedTo: CardInstanceId | null;
    donValue: number;
}

export type CardInstance =
    | CharacterInstance
    | LeaderInstance
    | StageInstance
    | EventInstance
    | DonInstance;

export type CardDatabase = Record<CardId, Card>;

/**
 * A card as it was at a single instant — the unit signals carry as their subjects,
 * and the universal input to `evalCardFilter`.
 *
 * Live evaluation is "a snapshot taken now"; last-known information is "a snapshot
 * taken then". Same type either way — the only difference is when `captureSnapshot`
 * ran. Keeping it one type is what stops `CardFilter` forking into live and frozen
 * paths across its three users (activation subjects, StatusEffectDef.affects,
 * actionGen gating).
 *
 * Holds identity plus everything MUTABLE. Printed identity — name, colors, types,
 * attributes — is recovered from `cardId` instead, because `state.definitions` is
 * immutable for the life of the game: a lookup later returns exactly what a copy now
 * would have. Capture exists for the fields that CHANGE, so copying the ones that
 * cannot is pure weight on `gameLog`.
 */
export interface CardSnapshot {
    instanceId: CardInstanceId;
    /** null for DON, which carries no `cardId` and has no definition. */
    cardId: CardId | null;
    class: CardClass;
    controller: PlayerId;
    /** Where the card was at capture. null while a DON is attached to a card. */
    zoneAtCapture: Zone | null;
    isRested: boolean;
    /** null for classes with no flipped state (DON, LEADER). */
    flipped: boolean | null;
    attachedDon: CardInstanceId[];

    /**
     * Stats in both forms, because `CardFilter` asks for both — COST/POWER/COUNTER
     * each carry a `base` flag. Base is not simply the printed value: an effect can
     * rewrite it, which is why it is captured rather than read back off the def.
     *
     * The derived form is the reason capture exists at all — a character trashed from
     * the field loses its attached DON on the way out, so only a snapshot taken first
     * can still report the power it was trashed at.
     *
     * null when the class has no such stat (a DON has no counter, an event no power).
     */
    power: number | null;
    basePower: number | null;
    cost: number | null;
    baseCost: number | null;
    counter: number | null;
    baseCounter: number | null;
}