import { create } from "zustand";
import type { PetLedge } from "@/pets/ledge";

/**
 * The composer that owns the visible input box, and the ledge it reports.
 *
 * The pet has to park a bottom peek exactly on the input box's top edge. The
 * number cannot be a constant (the box grows with a multi-line draft, with the
 * dynamic type size, and its dock pads by the bottom safe area) and it cannot be
 * "the last dock that laid out": several docks are mounted at once — a retained
 * panel, a draft tab, New workspace — and a screen without a composer would keep
 * using whichever one reported last.
 *
 * So each composer that is actually the user's composer *claims* the ledge, and
 * the newest claim wins. A claim is released when the composer loses pane focus,
 * goes fullscreen, or unmounts, at which point the previous claimant takes over
 * again — that is what makes closing a modal form hand the ledge back to the
 * workspace composer underneath it instead of leaving the pet with no ledge.
 */
export interface PetLedgeClaim {
  /** Where the visible input box's top edge and columns sit, keyboard closed. */
  readonly ledge: PetLedge;
  /**
   * The claimant's own keyboard translation, so the pet layer can ride the same
   * driver instead of approximating it. A centered dock lifts its form by the
   * keyboard overlap minus a clearance; a bottom-anchored one by the full shift.
   */
  readonly translation: { readonly enabled: boolean; readonly bottomClearance: number };
}

interface PetLedgeState {
  /** Claims keyed by claim order; the highest key is the current owner. */
  readonly claims: ReadonlyMap<number, PetLedgeClaim>;
  readonly nextSeq: number;
  /** Claim the ledge. Returns the sequence number to update or release with. */
  readonly claim: (claim: PetLedgeClaim) => number;
  /** Replace a live claim's numbers without changing its precedence. */
  readonly update: (seq: number, claim: PetLedgeClaim) => void;
  readonly release: (seq: number) => void;
}

export const usePetLedgeStore = create<PetLedgeState>((set) => ({
  claims: new Map(),
  nextSeq: 1,
  claim: (claim) => {
    let seq = 0;
    set((state) => {
      seq = state.nextSeq;
      const claims = new Map(state.claims);
      claims.set(seq, claim);
      return { claims, nextSeq: seq + 1 };
    });
    // `set` runs its updater synchronously, so `seq` is assigned by now.
    return seq;
  },
  update: (seq, claim) => {
    set((state) => {
      if (!state.claims.has(seq)) return state;
      const claims = new Map(state.claims);
      claims.set(seq, claim);
      return { claims };
    });
  },
  release: (seq) => {
    set((state) => {
      if (!state.claims.has(seq)) return state;
      const claims = new Map(state.claims);
      claims.delete(seq);
      return { claims };
    });
  },
}));

/**
 * The current owner's claim, or `null` when no composer claims the ledge.
 *
 * Selecting the newest key rather than storing an owner id keeps a released
 * claim from having to elect its successor: the map *is* the stack.
 */
export function selectPetLedgeClaim(state: {
  readonly claims: ReadonlyMap<number, PetLedgeClaim>;
}): PetLedgeClaim | null {
  let owner: PetLedgeClaim | null = null;
  let ownerSeq = -1;
  for (const [seq, claim] of state.claims) {
    if (seq > ownerSeq) {
      ownerSeq = seq;
      owner = claim;
    }
  }
  return owner;
}
