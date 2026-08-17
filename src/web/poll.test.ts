import { afterEach, describe, expect, it, vi } from "vitest";
import { startSerialPolling } from "./poll";

describe("startSerialPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the current request before scheduling another and stops cleanly", async () => {
    vi.useFakeTimers();
    let finishRequest: (() => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRequest = resolve;
        }),
    );

    const stop = startSerialPolling(request, 1_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(request).toHaveBeenCalledTimes(1);

    finishRequest?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);

    stop();
    finishRequest?.();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
