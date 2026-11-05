/**
 * Commit graph layout.
 *
 * Commits arrive newest-first in topological order. We walk them once while
 * tracking "lanes": each lane holds the hash of the commit it is waiting for.
 * For every row we emit the segments needed to draw it independently, which
 * lets the list be virtualised (only visible rows are rendered).
 */
import type { Commit } from "./api";

export const LANE_COLORS = [
  "oklch(0.72 0.24 328)", // fuchsia
  "oklch(0.72 0.17 285)", // violet
  "oklch(0.76 0.13 230)", // sky
  "oklch(0.78 0.15 160)", // emerald
  "oklch(0.82 0.14 80)", // amber
  "oklch(0.72 0.19 15)", // rose
  "oklch(0.8 0.12 195)", // cyan
  "oklch(0.84 0.16 125)", // lime
];

export const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

/** A line within one row. y is 0 (top), 0.5 (centre) or 1 (bottom). */
export interface Segment {
  fromLane: number;
  fromY: number;
  toLane: number;
  toY: number;
  color: string;
}

export interface GraphRow {
  lane: number;
  color: string;
  isMerge: boolean;
  segments: Segment[];
}

export interface GraphLayout {
  rows: GraphRow[];
  maxLanes: number;
}

export function layoutGraph(commits: Commit[]): GraphLayout {
  const lanes: (string | null)[] = [];
  // Colour belongs to a lane for as long as it is occupied.
  const laneColors: string[] = [];
  let colorCursor = 0;
  const rows: GraphRow[] = [];
  let maxLanes = 1;

  const claimLane = (hash: string, avoid = -1): number => {
    let idx = lanes.findIndex((l, i) => l === null && i !== avoid);
    if (idx === -1) idx = lanes.length;
    lanes[idx] = hash;
    laneColors[idx] = LANE_COLORS[colorCursor++ % LANE_COLORS.length];
    return idx;
  };

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash);
    // A branch tip: nothing above it leads here, so its lane starts at this row.
    const isTip = lane === -1;
    if (isTip) lane = claimLane(commit.hash);

    const before = lanes.slice();
    const colorsBefore = laneColors.slice();
    const color = laneColors[lane];
    const segments: Segment[] = [];

    // Top half: lines coming from the row above.
    before.forEach((h, i) => {
      if (h === null || (isTip && i === lane)) return;
      if (h === commit.hash) {
        segments.push({ fromLane: i, fromY: 0, toLane: lane, toY: 0.5, color: colorsBefore[i] });
      } else {
        segments.push({ fromLane: i, fromY: 0, toLane: i, toY: 0.5, color: colorsBefore[i] });
      }
    });

    // This commit is now drawn; free every lane that was waiting for it.
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null;

    // Parents take over lanes.
    const [first, ...rest] = commit.parents;
    const targets: number[] = [];
    if (first !== undefined) {
      const existing = lanes.indexOf(first);
      if (existing !== -1) {
        targets.push(existing);
      } else {
        lanes[lane] = first;
        laneColors[lane] = color;
        targets.push(lane);
      }
    }
    for (const p of rest) {
      const existing = lanes.indexOf(p);
      targets.push(existing !== -1 ? existing : claimLane(p, lane));
    }

    // Bottom half: pass-through lanes continue straight, this commit fans out.
    lanes.forEach((h, i) => {
      if (h === null) return;
      if (before[i] !== null && before[i] !== commit.hash && h === before[i]) {
        segments.push({ fromLane: i, fromY: 0.5, toLane: i, toY: 1, color: laneColors[i] });
      }
    });
    for (const t of targets) {
      segments.push({ fromLane: lane, fromY: 0.5, toLane: t, toY: 1, color: laneColors[t] });
    }

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneColors.pop();
    }

    maxLanes = Math.max(maxLanes, before.length, lanes.length, lane + 1);
    rows.push({ lane, color, isMerge: commit.parents.length > 1, segments });
  }

  return { rows, maxLanes };
}
