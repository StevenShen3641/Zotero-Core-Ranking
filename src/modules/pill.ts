import { NO_RANK, rankTier } from "./rankings/ranks";
import type { RankSystem } from "./rankings/ranks";

// Pill colors, best rank first: CORE A*, A and B; CCF A, B and C take the
// same colors by tier. Every other rank, CORE C included, is black.
const PILL_COLORS = ["#CF0000", "#D700AF", "#5F2FAF"];
const OTHER_PILL_COLOR = "#000000";

/** The pill's text: "CORE A*", "CCF-A". */
function pillLabel(system: RankSystem, rank: string): string {
  return system === "CCF" ? `CCF-${rank}` : `CORE ${rank}`;
}

/**
 * A saved rank drawn as a pill, for the Rank column and the venue panel. A
 * rank set by hand to "no rank" is a dash.
 */
export function createPill(
  doc: Document,
  system: RankSystem,
  rank: string,
): HTMLElement {
  const pill = doc.createElement("span");
  if (rank === NO_RANK) {
    pill.textContent = "—";
    return pill;
  }
  pill.textContent = pillLabel(system, rank);
  Object.assign(pill.style, {
    backgroundColor: PILL_COLORS[rankTier(system, rank)] ?? OTHER_PILL_COLOR,
    color: "#fff",
    borderRadius: "8px",
    padding: "0 7px",
    fontSize: "0.85em",
    fontWeight: "600",
    lineHeight: "1.6",
    whiteSpace: "nowrap",
  });
  return pill;
}
