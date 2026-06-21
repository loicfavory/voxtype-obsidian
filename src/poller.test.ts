import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { poll, sleep } from "./poller";
import type { PollOptions } from "./poller";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the requested delay", async () => {
    const promise = sleep(1_000);
    vi.advanceTimersByTime(999);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("resolves immediately for sleep(0)", async () => {
    const promise = sleep(0);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
  });

  it("does not throw when created with a very large value", () => {
    // One day in ms : large enough for the test, small enough not to overflow fake timers.
    expect(() => sleep(24 * 60 * 60 * 1000)).not.toThrow();
  });
});

describe("poll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const options = (overrides?: Partial<PollOptions>): PollOptions => ({
    intervalMs: 1_000,
    timeoutMs: 5_000,
    ...overrides,
  });

  it("succeeds on the first check", async () => {
    const check = vi.fn().mockResolvedValue("value");
    const promise = poll(check, options());

    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toEqual({
      outcome: "success",
      value: "value",
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("succeeds after N iterations", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue("value");
    const promise = poll(check, options());

    await vi.advanceTimersByTimeAsync(2_500);

    await expect(promise).resolves.toEqual({
      outcome: "success",
      value: "value",
    });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("returns timeout when check always returns null", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const promise = poll(check, options());

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toEqual({ outcome: "timeout" });
  });

  it("returns error immediately when check throws", async () => {
    const check = vi.fn().mockRejectedValue(new Error("boom"));
    const promise = poll(check, options());

    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toEqual({
      outcome: "error",
      message: "boom",
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("handles non-Error throws", async () => {
    const check = vi.fn().mockImplementation(() => {
      throw "oops";
    });
    const promise = poll(check, options());

    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toEqual({
      outcome: "error",
      message: "oops",
    });
  });

  it("does not call check when timeoutMs is 0", async () => {
    const check = vi.fn().mockResolvedValue("value");
    const promise = poll(check, options({ timeoutMs: 0 }));

    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toEqual({ outcome: "timeout" });
    expect(check).not.toHaveBeenCalled();
  });

  it("bounds the call count when intervalMs is 0", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const promise = poll(check, options({ intervalMs: 0, timeoutMs: 1_000 }));

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({ outcome: "timeout" });
    expect(check.mock.calls.length).toBeGreaterThan(0);
    expect(check.mock.calls.length).toBeLessThanOrEqual(1_001);
  });

  it("clamps the wait to the remaining time when intervalMs exceeds timeoutMs", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const promise = poll(check, options({ intervalMs: 10_000, timeoutMs: 1_000 }));

    await vi.advanceTimersByTimeAsync(999);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toEqual({ outcome: "timeout" });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("calls sleep with Math.min(intervalMs, remaining)", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const sleepFn = vi.fn((ms: number) => sleep(ms));
    const promise = poll(check, options({ intervalMs: 10_000, timeoutMs: 3_000 }), sleepFn);

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toEqual({ outcome: "timeout" });

    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(3_000);
  });
});
