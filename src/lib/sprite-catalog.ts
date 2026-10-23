// Catálogo de personagens disponíveis. Skins antigas podem ter 4 sheets;
// skins novas usam down/up/left e renderizam right espelhado do left.

import avatarDown from "@/assets/avatar-down.png";
import avatarUp from "@/assets/avatar-up.png";
import avatarLeft from "@/assets/avatar-left.png";
import avatarRight from "@/assets/avatar-right.png";

import blondeDown from "@/assets/sprites/blonde-down.png";
import blondeUp from "@/assets/sprites/blonde-up.png";
import blondeLeft from "@/assets/sprites/blonde-left.png";
import blondeRight from "@/assets/sprites/blonde-right.png";

import curlyDown from "@/assets/sprites/curly-down.png";
import curlyUp from "@/assets/sprites/curly-up.png";
import curlyLeft from "@/assets/sprites/curly-left.png";


import redheadDown from "@/assets/sprites/redhead-down.png";
import redheadUp from "@/assets/sprites/redhead-up.png";
import redheadLeft from "@/assets/sprites/redhead-left.png";
import redheadRight from "@/assets/sprites/redhead-right.png";

import afroDown from "@/assets/sprites/afro-down.png";
import afroUp from "@/assets/sprites/afro-up.png";
import afroLeft from "@/assets/sprites/afro-left.png";
import afroRight from "@/assets/sprites/afro-right.png";

import japaDown from "@/assets/sprites/japa-down.png";
import japaUp from "@/assets/sprites/japa-up.png";
import japaLeft from "@/assets/sprites/japa-left.png";

import morenaDown from "@/assets/sprites/morena-down.png";
import morenaUp from "@/assets/sprites/morena-up.png";
import morenaLeft from "@/assets/sprites/morena-left.png";

import latinaDown from "@/assets/sprites/latina-down.png";
import latinaUp from "@/assets/sprites/latina-up.png";
import latinaLeft from "@/assets/sprites/latina-left.png";

import indiDown from "@/assets/sprites/indi-down.png";
import indiUp from "@/assets/sprites/indi-up.png";
import indiLeft from "@/assets/sprites/indi-left.png";

import biaDown from "@/assets/sprites/bia-down.png";
import biaUp from "@/assets/sprites/bia-up.png";
import biaLeft from "@/assets/sprites/bia-left.png";

import patDown from "@/assets/sprites/pat-down.png";
import patUp from "@/assets/sprites/pat-up.png";
import patLeft from "@/assets/sprites/pat-left.png";

import luDown from "@/assets/sprites/lu-down.png";
import luUp from "@/assets/sprites/lu-up.png";
import luLeft from "@/assets/sprites/lu-left.png";
import luRight from "@/assets/sprites/lu-right.png";

import wilyDown from "@/assets/sprites/wily-down.png";
import wilyUp from "@/assets/sprites/wily-up.png";
import wilyLeft from "@/assets/sprites/wily-left.png";
import wilyRight from "@/assets/sprites/wily-right.png";

import lolaDown from "@/assets/sprites/lola-down.png";
import lolaUp from "@/assets/sprites/lola-up.png";
import lolaLeft from "@/assets/sprites/lola-left.png";
import lolaRight from "@/assets/sprites/lola-right.png";

import yuryDown from "@/assets/sprites/yury-down.png";
import yuryUp from "@/assets/sprites/yury-up.png";
import yuryLeft from "@/assets/sprites/yury-left.png";
import yuryRight from "@/assets/sprites/yury-right.png";

import lexaDown from "@/assets/sprites/lexa-down.png";
import lexaUp from "@/assets/sprites/lexa-up.png";
import lexaLeft from "@/assets/sprites/lexa-left.png";
import lexaRight from "@/assets/sprites/lexa-right.png";

import karenDown from "@/assets/sprites/karen-down.png";
import karenUp from "@/assets/sprites/karen-up.png";
import karenLeft from "@/assets/sprites/karen-left.png";
import karenRight from "@/assets/sprites/karen-right.png";
import lucasDown from "@/assets/sprites/lucas-down.png";
import lucasUp from "@/assets/sprites/lucas-up.png";
import lucasLeft from "@/assets/sprites/lucas-left.png";
import jorgDownAsset from "@/assets/sprites/jorg-down.png.asset.json";
import jorgUpAsset from "@/assets/sprites/jorg-up.png.asset.json";
import jorgLeftAsset from "@/assets/sprites/jorg-left.png.asset.json";
import catDownAsset from "@/assets/sprites/cat-down.png.asset.json";
import catUpAsset from "@/assets/sprites/cat-up.png.asset.json";
import catLeftAsset from "@/assets/sprites/cat-left.png.asset.json";

export type Facing = "up" | "down" | "left" | "right";

export type SpriteSheets = Record<Facing, string>;
export type SpriteDims = Record<Facing, { w: number; h: number }>;

export type SpriteDef = {
  id: string;
  label: string;
  gender: "m" | "f" | "n";
  sheets: SpriteSheets;
  dims: SpriteDims;
  /** Legado: quando true, a folha "left" é renderizada espelhando a "right". */
  mirrorLeftFromRight?: boolean;
  /** Quando true, a folha "right" é renderizada espelhando a "left" (padrão para skins novas). */
  mirrorRightFromLeft?: boolean;
  /** Variante experimental (V5, 1x, 2x) para o construtor de personagens futuro — oculta dos seletores. */
  variant?: boolean;
};

export const SPRITES: SpriteDef[] = [
  {
    id: "marcio",
    label: "Márcio",
    gender: "m",
    sheets: { up: avatarUp, down: avatarDown, left: avatarLeft, right: avatarRight },
    dims: {
      down: { w: 151, h: 245 },
      up: { w: 136, h: 235 },
      left: { w: 142, h: 235 },
      right: { w: 139, h: 235 },
    },
  },
  {
    id: "blonde",
    label: "Dany",
    gender: "f",
    sheets: { up: blondeUp, down: blondeDown, left: blondeLeft, right: blondeRight },
    dims: {
      down: { w: 255, h: 232 },
      up: { w: 255, h: 246 },
      left: { w: 255, h: 206 },
      right: { w: 255, h: 206 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "curly",
    label: "Anne",
    gender: "f",
    sheets: { up: curlyUp, down: curlyDown, left: curlyLeft, right: curlyLeft },
    dims: {
      down: { w: 144, h: 242 },
      up: { w: 136, h: 240 },
      left: { w: 148, h: 242 },
      right: { w: 148, h: 242 },
    },
    mirrorRightFromLeft: true,
  },

  {
    id: "redhead",
    label: "Lele",
    gender: "f",
    sheets: { up: redheadUp, down: redheadDown, left: redheadLeft, right: redheadRight },
    dims: {
      down: { w: 255, h: 228 },
      up: { w: 255, h: 222 },
      left: { w: 255, h: 213 },
      right: { w: 255, h: 213 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "afro",
    label: "Thamy",
    gender: "f",
    sheets: { up: afroUp, down: afroDown, left: afroLeft, right: afroRight },
    dims: {
      down: { w: 255, h: 243 },
      up: { w: 255, h: 242 },
      left: { w: 255, h: 227 },
      right: { w: 255, h: 227 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "japa",
    label: "Chun",
    gender: "f",
    sheets: { up: japaUp, down: japaDown, left: japaLeft, right: japaLeft },
    dims: {
      down: { w: 128, h: 248 },
      up: { w: 126, h: 250 },
      left: { w: 126, h: 236 },
      right: { w: 126, h: 236 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "morena",
    label: "Shae",
    gender: "f",
    sheets: { up: morenaUp, down: morenaDown, left: morenaLeft, right: morenaLeft },
    dims: {
      down: { w: 154, h: 254 },
      up: { w: 142, h: 252 },
      left: { w: 148, h: 254 },
      right: { w: 148, h: 254 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "latina",
    label: "Deby",
    gender: "f",
    sheets: { up: latinaUp, down: latinaDown, left: latinaLeft, right: latinaLeft },
    dims: {
      down: { w: 178, h: 242 },
      up: { w: 176, h: 242 },
      left: { w: 170, h: 246 },
      right: { w: 170, h: 246 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "indi",
    label: "Lory",
    gender: "f",
    sheets: { up: indiUp, down: indiDown, left: indiLeft, right: indiLeft },
    dims: {
      down: { w: 162, h: 232 },
      up: { w: 162, h: 232 },
      left: { w: 162, h: 232 },
      right: { w: 162, h: 232 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "bia",
    label: "Bia",
    gender: "f",
    sheets: { up: biaUp, down: biaDown, left: biaLeft, right: biaLeft },
    dims: {
      down: { w: 124, h: 228 },
      up: { w: 120, h: 230 },
      left: { w: 126, h: 230 },
      right: { w: 126, h: 230 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "pat",
    label: "Pat",
    gender: "f",
    sheets: { up: patUp, down: patDown, left: patLeft, right: patLeft },
    dims: {
      down: { w: 122, h: 248 },
      up: { w: 120, h: 248 },
      left: { w: 126, h: 248 },
      right: { w: 126, h: 248 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "lu",
    label: "Lu",
    gender: "f",
    sheets: { up: luUp, down: luDown, left: luLeft, right: luRight },
    dims: {
      down: { w: 118, h: 226 },
      up: { w: 116, h: 228 },
      left: { w: 124, h: 226 },
      right: { w: 116, h: 224 },
    },
  },
  {
    id: "wily",
    label: "Wily",
    gender: "f",
    sheets: { up: wilyUp, down: wilyDown, left: wilyLeft, right: wilyRight },
    dims: {
      down: { w: 120, h: 258 },
      up: { w: 116, h: 258 },
      left: { w: 120, h: 254 },
      right: { w: 114, h: 248 },
    },
  },
  {
    id: "lola",
    label: "Lola",
    gender: "f",
    sheets: { up: lolaUp, down: lolaDown, left: lolaLeft, right: lolaRight },
    dims: {
      down: { w: 120, h: 254 },
      up: { w: 116, h: 254 },
      left: { w: 120, h: 252 },
      right: { w: 114, h: 248 },
    },
  },
  {
    id: "yury",
    label: "Yury",
    gender: "m",
    sheets: { up: yuryUp, down: yuryDown, left: yuryLeft, right: yuryRight },
    dims: {
      down: { w: 130, h: 236 },
      up: { w: 130, h: 236 },
      left: { w: 156, h: 234 },
      right: { w: 154, h: 232 },
    },
  },
  {
    id: "lexa",
    label: "Lexa",
    gender: "f",
    sheets: { up: lexaUp, down: lexaDown, left: lexaLeft, right: lexaRight },
    dims: {
      down: { w: 168, h: 242 },
      up: { w: 162, h: 242 },
      left: { w: 158, h: 244 },
      right: { w: 150, h: 242 },
    },
  },
  {
    id: "karen",
    label: "Karen",
    gender: "f",
    sheets: { up: karenUp, down: karenDown, left: karenLeft, right: karenRight },
    dims: {
      down: { w: 126, h: 238 },
      up: { w: 126, h: 240 },
      left: { w: 142, h: 238 },
      right: { w: 136, h: 238 },
    },
  },
  {
    id: "lucas",
    label: "Lucas",
    gender: "m",
    sheets: { up: lucasUp, down: lucasDown, left: lucasLeft, right: lucasLeft },
    dims: {
      down: { w: 142, h: 244 },
      up: { w: 142, h: 250 },
      left: { w: 150, h: 248 },
      right: { w: 150, h: 248 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "jorg",
    label: "Jorg",
    gender: "m",
    sheets: { down: jorgDownAsset.url, up: jorgUpAsset.url, left: jorgLeftAsset.url, right: jorgLeftAsset.url },
    dims: {
      down: { w: 136, h: 232 },
      up: { w: 128, h: 232 },
      left: { w: 132, h: 232 },
      right: { w: 132, h: 232 },
    },
    mirrorRightFromLeft: true,
  },
  {
    id: "cat",
    label: "Cat",
    gender: "f",
    sheets: { down: catDownAsset.url, up: catUpAsset.url, left: catLeftAsset.url, right: catLeftAsset.url },
    dims: {
      down: { w: 140, h: 236 },
      up: { w: 136, h: 238 },
      left: { w: 148, h: 238 },
      right: { w: 148, h: 238 },
    },
    mirrorRightFromLeft: true,
  },
];

export const SPRITE_FRAMES = 6;
export const DEFAULT_SPRITE_ID = "marcio";

export function getSprite(id: string | null | undefined): SpriteDef {
  return SPRITES.find((s) => s.id === id) ?? SPRITES[0];
}

export const GENDER_GROUPS: { key: "m" | "f"; label: string }[] = [
  { key: "m", label: "Meninos" },
  { key: "f", label: "Meninas" },
];

export function groupSpritesByGender<T extends { gender: "m" | "f" | "n"; variant?: boolean }>(list: T[]) {
  return GENDER_GROUPS.map((g) => ({
    ...g,
    items: list.filter((s) => s.gender === g.key && !s.variant),
  })).filter((g) => g.items.length > 0);
}
