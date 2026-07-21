/**
 * Evidence store: the structured record of what a run found.
 *
 * The core discipline of Prism is that every finding is classified as either:
 *
 *   - observed:     Prism directly saw this (an HTTP status, a form in the DOM,
 *                   a line in robots.txt). It is a fact about the run.
 *   - hypothesized: Prism inferred this but has not confirmed it (a path named
 *                   in robots.txt that was never actually visited). It is a lead.
 *
 * The two are never conflated. Reporters render them in separate sections so a
 * reader can trust the "observed" section as ground truth and treat the
 * "hypothesized" section as things to verify.
 *
 * NOTE: the exact field set below was inferred from the prompt-1 design contract
 * (the tail of the request that defined `Evidence` was truncated). It is a plain
 * typed record and trivial to adjust.
 */

/** Whether a finding was directly seen or merely inferred. */
export type EvidenceKind = 'observed' | 'hypothesized';

/** Coarse bucket for grouping findings in reports. */
export type EvidenceCategory =
  | 'page' // a page Prism loaded
  | 'accessibility' // accessibility-tree summary
  | 'link' // an anchor/href discovered in the DOM
  | 'form' // a form discovered in the DOM
  | 'endpoint' // an HTTP path probed or referenced
  | 'resource' // robots.txt, sitemap.xml, and similar
  | 'technology' // a detected framework/library (e.g. Angular)
  | 'verification' // the result of verifying an earlier hypothesis
  | 'scope-violation' // a request the scope-guard refused
  | 'note'; // free-form annotation

/** Rough triage weight. Recon is descriptive, so most findings are informational. */
export type Severity = 'info' | 'low' | 'medium' | 'high';

/** Fields the caller supplies when recording a finding. */
export interface EvidenceInput {
  kind: EvidenceKind;
  category: EvidenceCategory;
  /** One-line summary of the finding. */
  title: string;
  /** Optional longer description or rationale (required reading for a hypothesis). */
  detail?: string | undefined;
  /** The URL the finding concerns, if any. */
  url?: string | undefined;
  /** HTTP method, when the finding came from a request. */
  method?: string | undefined;
  /** HTTP status code, when the finding came from a response. */
  status?: number | undefined;
  severity?: Severity | undefined;
  /** Which agent produced this (e.g. "recon"). */
  source: string;
  /** Arbitrary structured payload (link lists, form fields, headers, a11y tree...). */
  data?: Record<string, unknown> | undefined;
}

/**
 * What a caller passes to {@link EvidenceStore.observe} / {@link EvidenceStore.hypothesize}.
 * It is {@link EvidenceInput} without `kind`: the chosen method fixes the kind, so
 * an agent cannot record a finding without declaring whether it was seen or inferred.
 */
export type FindingInput = Omit<EvidenceInput, 'kind'>;

/** A recorded finding: the caller's input plus an id and a timestamp. */
export interface Evidence extends EvidenceInput {
  /** Stable, human-readable id assigned at record time (e.g. "E-0007"). */
  id: string;
  /** ISO-8601 timestamp of when the finding was recorded. */
  recordedAt: string;
}

/**
 * An append-only collection of {@link Evidence}. It assigns ids and timestamps,
 * and offers small query helpers the reporters use.
 */
export class EvidenceStore {
  private readonly items: Evidence[] = [];
  private seq = 0;

  /**
   * Record a finding. Private on purpose: callers must go through {@link observe}
   * or {@link hypothesize} so the observed/hypothesis distinction is always an
   * explicit, deliberate choice at the call site.
   */
  private record(input: EvidenceInput): Evidence {
    this.seq += 1;
    const id = `E-${String(this.seq).padStart(4, '0')}`;
    const evidence: Evidence = { ...input, id, recordedAt: new Date().toISOString() };
    this.items.push(evidence);
    return evidence;
  }

  /** Record a fact Prism directly saw. */
  observe(input: FindingInput): Evidence {
    return this.record({ ...input, kind: 'observed' });
  }

  /** Record an inference Prism has not confirmed — a lead to investigate. */
  hypothesize(input: FindingInput): Evidence {
    return this.record({ ...input, kind: 'hypothesized' });
  }

  /** All findings, in the order they were recorded. */
  all(): readonly Evidence[] {
    return this.items;
  }

  /** Findings of a given kind (observed / hypothesized). */
  byKind(kind: EvidenceKind): Evidence[] {
    return this.items.filter((e) => e.kind === kind);
  }

  /** Directly-seen findings. */
  observed(): Evidence[] {
    return this.byKind('observed');
  }

  /** Inferred, unconfirmed findings. */
  hypothesized(): Evidence[] {
    return this.byKind('hypothesized');
  }

  /** Findings in a given category. */
  byCategory(category: EvidenceCategory): Evidence[] {
    return this.items.filter((e) => e.category === category);
  }

  /** Total number of findings recorded. */
  count(): number {
    return this.items.length;
  }

  /** A plain-object snapshot suitable for `JSON.stringify`. */
  toJSON(): Evidence[] {
    return [...this.items];
  }
}
