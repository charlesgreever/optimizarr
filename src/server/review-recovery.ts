export const KEEP_INTERRUPTED = "Keep was interrupted. Try Keep again.";
export const SIDECAR_GONE = "The sidecar is gone. Discard this card or run the job again.";

export type InterruptedKeepKind = "complete" | "interrupted" | "sidecar_gone";

export function classifyInterruptedKeep(input: {
  sidecarExists: boolean;
  libraryBytes: number | null;
  sourceBytes: number;
  sidecarBytes: number;
}): InterruptedKeepKind {
  const libraryLooksLikeSidecar =
    input.libraryBytes != null &&
    input.sidecarBytes > 0 &&
    input.libraryBytes === input.sidecarBytes &&
    input.libraryBytes !== input.sourceBytes;
  if (libraryLooksLikeSidecar) return "complete";
  if (!input.sidecarExists) return "sidecar_gone";
  return "interrupted";
}
