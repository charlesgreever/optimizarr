import { ffprobeFile, parseFfprobe, type InspectionReport } from "./inspect.ts";
import { buildSuggestion } from "./suggest.ts";
import type { Store } from "./store.ts";

export type ProbeFn = (path: string) => Promise<InspectionReport> | InspectionReport;

export type InspectProgress = {
  pending: number;
  inspected: number;
  errors: number;
  left: number;
  total: number;
  walking: boolean;
};

export async function defaultProbe(path: string): Promise<InspectionReport> {
  return ffprobeFile(path);
}

export class Catalog {
  private walk: Promise<number> | null = null;
  onInspected: ((itemId: number) => Promise<void>) | undefined;

  constructor(
    private store: Store,
    private probe: ProbeFn = defaultProbe,
  ) {}

  sourceSig(path: string, size: number | null): string {
    return `${path}|${size ?? 0}`;
  }

  progress(): InspectProgress {
    let pending = 0;
    let inspected = 0;
    let errors = 0;
    for (const item of this.store.listLibraryItems()) {
      if (!item.path || !item.readable) continue;
      if (this.store.getInspectionSig(item.id) !== this.sourceSig(item.path, item.size)) {
        pending += 1;
        continue;
      }
      if (isFailedInspection(this.store.getInspection(item.id))) errors += 1;
      else inspected += 1;
    }
    const total = pending + inspected + errors;
    return { pending, inspected, errors, left: pending, total, walking: this.walk !== null };
  }

  startBackgroundInspect(): void {
    void this.inspectPending().catch(() => undefined);
  }

  async inspectItem(
    itemId: number,
    opts?: { force?: boolean; addStereo?: boolean },
  ): Promise<{ onSuggestions: boolean; error?: string }> {
    const item = this.store.getLibraryItem(itemId);
    if (!item) return { onSuggestions: false, error: "Title not found" };
    if (!item.path) return { onSuggestions: false, error: "No file to inspect" };
    if (this.store.isExcluded(item) && !opts?.force) {
      return { onSuggestions: false, error: "This title is excluded" };
    }
    const sourceSig = this.sourceSig(item.path, item.size);
    if (!opts?.force && !opts?.addStereo && this.store.getInspectionSig(itemId) === sourceSig) {
      return { onSuggestions: false };
    }
    if (!item.readable && !opts?.force) {
      return { onSuggestions: false, error: item.pathError || "This file is not readable yet." };
    }
    let report: InspectionReport;
    try {
      report = await this.probe(item.path);
    } catch {
      let existing: unknown;
      try {
        existing = this.store.getInspection(itemId);
      } catch {
        return { onSuggestions: false, error: "Could not inspect this file." };
      }
      if (!existing || isFailedInspection(existing)) {
        this.store.saveInspection(itemId, { probeFailed: true }, new Date().toISOString(), sourceSig);
        return { onSuggestions: false, error: "Could not inspect this file." };
      }
      report = existing as InspectionReport;
    }
    this.store.saveInspection(itemId, report, new Date().toISOString(), sourceSig);
    const plan = buildSuggestion(report, this.store.getSettings(), item.type, {
      force: opts?.force,
      addStereo: opts?.addStereo,
    });
    if (plan.healthy && !opts?.force) {
      if (opts?.addStereo) {
        return { onSuggestions: false, error: "This file already has a stereo track." };
      }
      this.store.saveSuggestion({
        itemId,
        actions: [],
        warning: null,
        estimatedSavingsBytes: null,
        overCap: false,
        extraTracks: false,
        category: plan.category,
        sizePerHourGb: plan.sizePerHourGb,
        plan,
        dismissed: false,
        forced: false,
      });
      if (this.onInspected) await this.onInspected(itemId);
      return { onSuggestions: false };
    }
    this.store.saveSuggestion({
      itemId,
      actions: plan.actions,
      warning: plan.warning,
      estimatedSavingsBytes: plan.estimatedSavingsBytes,
      overCap: plan.overCap,
      extraTracks: plan.extraTracks,
      category: plan.category,
      sizePerHourGb: plan.sizePerHourGb,
      plan,
      forced: Boolean(opts?.force),
      dismissed: false,
    });
    if (this.onInspected) await this.onInspected(itemId);
    return { onSuggestions: plan.actions.length > 0 || Boolean(opts?.force) };
  }

  async inspectAll(opts?: { force?: boolean }): Promise<number> {
    return this.inspectPending(opts);
  }

  async inspectPending(opts?: { force?: boolean }): Promise<number> {
    if (this.walk) return this.walk;
    this.walk = this.walkPending(opts).finally(() => {
      this.walk = null;
    });
    return this.walk;
  }

  private async walkPending(opts?: { force?: boolean }): Promise<number> {
    let n = 0;
    if (opts?.force) {
      for (const item of this.store.listLibraryItems()) {
        await this.inspectItem(item.id, opts);
        n += 1;
        if (n % 3 === 0) await yieldWalk();
      }
      return n;
    }
    let item = this.nextPending();
    while (item) {
      await this.inspectItem(item.id);
      n += 1;
      if (n % 3 === 0) await yieldWalk();
      item = this.nextPending();
    }
    return n;
  }

  private nextPending() {
    for (const item of this.store.listLibraryItems()) {
      if (!item.path || !item.readable) continue;
      if (this.store.getInspectionSig(item.id) === this.sourceSig(item.path, item.size)) continue;
      return item;
    }
    return undefined;
  }
}

export function isFailedInspection(report: unknown): boolean {
  return Boolean(report && typeof report === "object" && (report as { probeFailed?: unknown }).probeFailed === true);
}

function yieldWalk(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function reportFromFixture(path: string, fixture: Record<string, unknown>): InspectionReport {
  return parseFfprobe(path, fixture);
}
