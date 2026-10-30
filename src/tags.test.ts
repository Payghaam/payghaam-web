import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Payghaam } from "./index.js";

describe("Tag Debouncing and Batching", () => {
  let updateTagsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    updateTagsSpy = vi.fn().mockResolvedValue({ accepted: true });

    // Mock global localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    });

    Payghaam.initialize({
      apiKey: "ek_client_test123",
      baseUrl: "https://mock.api.payghaam.com/api",
      tagDebounceMs: 250,
      quiet: true,
    });

    // Mock internal api client's updateTags
    (Payghaam as unknown as { api: { updateTags: typeof updateTagsSpy } }).api.updateTags = updateTagsSpy;
  });

  afterEach(() => {
    Payghaam.logout();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces multiple addTag calls within debounce window into a single HTTP request", async () => {
    await Payghaam.login("user-101");

    // Rapid successive tag calls
    void Payghaam.addTag("plan", "pro");
    void Payghaam.addTag("seats", 5);
    void Payghaam.addTag("country", "US");

    // Before timer advances: 0 network calls
    expect(updateTagsSpy).not.toHaveBeenCalled();

    // Advance time past debounce window
    await vi.advanceTimersByTimeAsync(300);

    // Exactly 1 network request made
    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    expect(updateTagsSpy).toHaveBeenCalledWith("user-101", {
      plan: "pro",
      seats: 5,
      country: "US",
    });
  });

  it("overwrites duplicate tag keys with latest value in the batch", async () => {
    await Payghaam.login("user-102");

    void Payghaam.addTag("status", "pending");
    void Payghaam.addTag("status", "active");

    await vi.advanceTimersByTimeAsync(300);

    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    expect(updateTagsSpy).toHaveBeenCalledWith("user-102", {
      status: "active",
    });
  });

  it("merges dictionary from addTags with individual addTag calls", async () => {
    await Payghaam.login("user-103");

    void Payghaam.addTags({ theme: "dark", role: "admin" });
    void Payghaam.addTag("notifications_enabled", true);

    await vi.advanceTimersByTimeAsync(300);

    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    expect(updateTagsSpy).toHaveBeenCalledWith("user-103", {
      theme: "dark",
      role: "admin",
      notifications_enabled: true,
    });
  });

  it("immediately flushes when flushTags() is called without waiting for timer", async () => {
    await Payghaam.login("user-104");

    void Payghaam.addTag("source", "campaign_123");
    expect(updateTagsSpy).not.toHaveBeenCalled();

    await Payghaam.flushTags();

    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    expect(updateTagsSpy).toHaveBeenCalledWith("user-104", {
      source: "campaign_123",
    });
  });

  it("flushes pending tags before logging out", async () => {
    await Payghaam.login("user-105");

    void Payghaam.addTag("score", 99);
    expect(updateTagsSpy).not.toHaveBeenCalled();

    Payghaam.logout();

    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    expect(updateTagsSpy).toHaveBeenCalledWith("user-105", {
      score: 99,
    });
  });
});
