/**
 * Shareable-URL gateway for reproducible walks (US-022).
 *
 * Reads the optional `?seed=` (and `?count=`) query parameters on load, and reflects the seed +
 * waypoint count that produced the current walk back into the address bar after each generation —
 * WITHOUT reloading the page. This is the ONLY place that touches the browser URL / history, so the
 * domain stays entirely seed-agnostic (docs/adr/0003, US-022 AC4). `DomControls` depends on the
 * {@link WalkUrl} interface, so it is unit-testable with an in-memory fake; {@link productionWalkUrl}
 * is the live implementation backed by `window.location` + `history.replaceState`.
 */

/** The seed + waypoint count parsed from the URL (each `null` when absent or not a valid integer). */
export interface WalkUrlParams {
  readonly seed: number | null;
  readonly count: number | null;
}

/** Reads / reflects the `?seed=&count=` URL parameters. */
export interface WalkUrl {
  /** The seed + count currently in the URL (each `null` if missing / unparseable). */
  read(): WalkUrlParams;
  /** Reflect the seed + count that produced the current walk into the URL, without reloading. */
  reflect(params: { readonly seed: number; readonly count: number }): void;
}

/** URL parameter names, kept in one place so {@link WalkUrl.read} and {@link WalkUrl.reflect} agree. */
const SEED_PARAM = "seed";
const COUNT_PARAM = "count";

/** Parse a base-10 integer query value, or `null` if it is absent / blank / non-numeric. */
function parseIntParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Production {@link WalkUrl}: reads `window.location.search` and writes back with
 * `history.replaceState` (REPLACE, not push, so a run of Generates does not flood the back button).
 * It preserves the path, any other query parameters, and the hash.
 *
 * Both methods are guarded by `typeof window` so importing this module — or driving the composition
 * root — in Node (the headless gates) is side-effect-free: `read()` reports "no params" (entropy
 * default) and `reflect()` is a no-op, exactly as if the page were loaded with a bare URL.
 */
export const productionWalkUrl: WalkUrl = {
  read(): WalkUrlParams {
    if (typeof window === "undefined") return { seed: null, count: null };
    const params = new URLSearchParams(window.location.search);
    return {
      seed: parseIntParam(params.get(SEED_PARAM)),
      count: parseIntParam(params.get(COUNT_PARAM)),
    };
  },
  reflect({ seed, count }): void {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set(SEED_PARAM, String(seed));
    params.set(COUNT_PARAM, String(count));
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  },
};
