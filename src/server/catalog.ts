import { ffprobeFile, parseFfprobe, type InspectionReport } from "./inspect.ts";
import { buildSuggestion } from "./suggest.ts";
import type { Store } from "./store.ts";

export type ProbeFn = (path: string) => Promise<InspectionReport> | InspectionReport;

export async function defaultProbe(path: string): Promise<InspectionReport> {
  return ffprobeFile(path);
}

export class Catalog {
  constructor(
    private store: Store,
    private probe: ProbeFn = defaultProbe,
  ) {}

  async inspectItem(itemId: number, opts?: { force?: boolean; addStereo?: boolean }): Promise<void> {
    const item = this.store.getLibraryItem(itemId);
    if (!item || !item.path) return;
    if (this.store.isExcluded(item) && !opts?.force) return;
    const sourceSig = `${item.path}|${item.size ?? 0}`;
    if (!opts?.force && !opts?.addStereo && this.store.getInspectionSig(itemId) === sourceSig) {
      return;
    }
    if (!item.readable && !opts?.force) return;
    let report: InspectionReport;
    try {
      report = await this.probe(item.path);
    } catch {
      const existing = this.store.getInspection(itemId) as InspectionReport | undefined;
      if (!existing) return;
      report = existing;
    }
    this.store.saveInspection(itemId, report, new Date().toISOString(), sourceSig);
    const plan = buildSuggestion(report, this.store.getSettings(), item.type, {
      force: opts?.force,
      addStereo: opts?.addStereo,
    });
    if (plan.healthy && !opts?.force) {
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
      return;
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
  }

  async inspectAll(opts?: { force?: boolean }): Promise<number> {
    let n = 0;
    for (const item of this.store.listLibraryItems()) {
      await this.inspectItem(item.id, opts);
      n += 1;
    }
    return n;
  }
}

export function reportFromFixture(path: string, fixture: Record<string, unknown>): InspectionReport {
  return parseFfprobe(path, fixture);
}
