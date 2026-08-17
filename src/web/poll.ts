export function startSerialPolling(task: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    try {
      await task();
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), intervalMs);
    }
  };

  void run();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
