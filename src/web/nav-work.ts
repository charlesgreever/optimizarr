export type WorkSnapshot = {
  queueActive: number;
  review: number;
  runningTitle: string | null;
};

export function navCount(n: number): number | null {
  return n > 0 ? n : null;
}

export function headerWorkLine(inspecting: boolean, pending: number, runningTitle: string | null): string {
  if (inspecting) return `Inspecting · ${pending} left`;
  if (runningTitle) return `Working · ${runningTitle}`;
  return "● Ready";
}
