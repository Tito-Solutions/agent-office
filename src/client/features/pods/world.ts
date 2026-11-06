import * as THREE from 'three';
import { signInk } from '../../../shared/floorplan';
import { POD_BOARD, STAGES, type Stage } from '../../../shared/pods';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The Pod board: a board on legs out on the open floor, the same on both faces, with a card for each
// delivery pod: who's in it, its issues by stage and its pull requests. index.ts says what's on it;
// this draws it.

/** What a pod's card on the board shows. */
export interface PodCard {
  name: string;
  color: string;
  /** "PA Rhona · Dev JP". */
  people: string;
  stages: Record<Stage, number>;
  prs: number;
  inReview: number;
}

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const INK = '#2b2d42';
const MUTED = '#6c757d';
/** The face's canvas, in pixels per meter. */
const PX = 420;
const STAGE_SHORT: Record<Stage, string> = { prepare: 'Prep', plan: 'Plan', build: 'Build', release: 'Rel' };

let canvas: HTMLCanvasElement | undefined;
let texture: THREE.CanvasTexture | undefined;

/** The board's face, the same canvas on every Pod board there is. */
function face(): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  if (!canvas || !texture) {
    canvas = document.createElement('canvas');
    canvas.width = Math.round(POD_BOARD.width * PX);
    canvas.height = Math.round(POD_BOARD.height * PX);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  return { canvas, texture };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Text cut to fit `max` pixels, with an ellipsis. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws the pods on the board: a card each, or a note when there are none yet. */
export function drawPodBoard(cards: readonly PodCard[], floorName: string | undefined) {
  const { canvas: c, texture: tex } = face();
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#fffaf3';
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';

  // The title along the top.
  g.fillStyle = INK;
  g.textAlign = 'left';
  g.font = `900 64px ${FONT}`;
  g.fillText('👥 Pods', 40, 56);
  g.font = `700 30px ${FONT}`;
  g.fillStyle = MUTED;
  g.textAlign = 'right';
  g.fillText(floorName ? `Issues and PRs on ${floorName} · press E` : 'Press E for the roster', W - 40, 58);

  if (!cards.length) {
    g.textAlign = 'center';
    g.font = `800 56px ${FONT}`;
    g.fillText('No pods yet: an admin adds them with E', W / 2, H / 2);
    tex.needsUpdate = true;
    return;
  }

  const cols = Math.min(4, Math.ceil(cards.length / Math.ceil(cards.length / 4)));
  const rows = Math.ceil(cards.length / cols);
  const top = 108;
  const gap = 22;
  const cw = (W - 40 * 2 - gap * (cols - 1)) / cols;
  const ch = (H - top - 30 - gap * (rows - 1)) / rows;
  // Sizes for the card's lines, scaled to how tall a card is.
  const s = Math.min(1, ch / 380);
  cards.forEach((card, i) => {
    const x = 40 + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    g.fillStyle = '#ffffff';
    roundRect(g, x, y, cw, ch, 22);
    g.fill();
    g.strokeStyle = '#dee2e6';
    g.lineWidth = 3;
    g.stroke();
    // The pod's color across the top, with its name.
    const band = 74 * s;
    g.save();
    roundRect(g, x, y, cw, ch, 22);
    g.clip();
    g.fillStyle = card.color;
    g.fillRect(x, y, cw, band);
    g.restore();
    g.fillStyle = signInk(card.color);
    g.textAlign = 'left';
    g.font = `900 ${Math.round(44 * s)}px ${FONT}`;
    g.fillText(fit(g, card.name, cw - 40), x + 20, y + band / 2 + 2);

    let ly = y + band + 44 * s;
    const line = (text: string, color = INK, weight = 800, size = 32) => {
      g.fillStyle = color;
      g.font = `${weight} ${Math.round(size * s)}px ${FONT}`;
      g.fillText(fit(g, text, cw - 40), x + 20, ly);
      ly += (size + 18) * s;
    };
    line(card.people || 'No members yet', card.people ? INK : MUTED, 700, 28);
    line(STAGES.map((st) => `${STAGE_SHORT[st]} ${card.stages[st]}`).join(' · '), MUTED, 700, 24);
    line(`🔀 ${card.prs} PR${card.prs === 1 ? '' : 's'}${card.inReview ? ` · ${card.inReview} in review` : ''}`, INK, 700, 28);
  });
  tex.needsUpdate = true;
}

/** The board on its legs, with the same face front and back. */
export const podBoard: Fixture = (site) => {
  const { x, z, width, height, bottom } = POD_BOARD;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const wood = toon('#9c6644');
  const dark = toon('#7f5539');
  const mid = bottom + height / 2;
  const post = width / 2 + 0.1;

  const frame = mesh(roundedBox(width + 0.16, 0.09, height + 0.16, 0.05), wood, 0, mid, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);
  const mat = new THREE.MeshBasicMaterial({ map: face().texture, toneMapped: false });
  for (const side of [1, -1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    plane.position.set(0, mid, side * 0.05);
    if (side < 0) plane.rotation.y = Math.PI;
    group.add(plane);
  }
  // Two legs on feet, and a rail between them.
  for (const sx of [-post, post]) {
    group.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, bottom + height + 0.15, 10), dark, sx, (bottom + height + 0.15) / 2, 0));
    group.add(mesh(roundedBox(0.12, 0.08, 0.9, 0.03), dark, sx, 0.04, 0));
  }
  group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, post * 2, 8).rotateZ(Math.PI / 2), dark, 0, 0.35, 0, false));

  for (const side of [1, -1]) {
    const plaque = textPlane('👥 Pods', { bg: '#fffaf3', size: 48 });
    plaque.scale.multiplyScalar(0.6);
    plaque.position.set(0, bottom + height + 0.32, side * 0.06);
    if (side < 0) plaque.rotation.y = Math.PI;
    group.add(plaque);
  }

  const collider: Collider = { minX: x - post - 0.1, maxX: x + post + 0.1, minZ: z - 0.46, maxZ: z + 0.46, top: bottom + height + 0.4 };
  const interactable: Interactable = { kind: 'pods', x, z, radius: 2.8 };
  group.userData.interact = interactable;
  return { group, colliders: [collider], interactables: [interactable] };
};
