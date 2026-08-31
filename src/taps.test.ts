import { describe, expect, it, vi } from "vitest";
import { TapDispatcher, normalizeTapPayload } from "./taps.js";

describe("TapDispatcher", () => {
  it("delivers to a registered handler", () => {
    const d = new TapDispatcher();
    const handler = vi.fn();
    d.register(handler);
    d.dispatch({ ek_url: "https://shop/1" });
    expect(handler).toHaveBeenCalledWith({ ek_url: "https://shop/1" });
  });

  // The tap that opened the tab arrives before any React effect has run. Without
  // buffering it is dropped, and the deep link silently does nothing — the most
  // reported bug in every push SDK.
  it("replays a tap that arrived before the handler registered", () => {
    const d = new TapDispatcher();
    d.dispatch({ ek_url: "https://shop/cold-start" });
    const handler = vi.fn();
    d.register(handler);
    expect(handler).toHaveBeenCalledWith({ ek_url: "https://shop/cold-start" });
  });

  it("replays each buffered tap exactly once", () => {
    const d = new TapDispatcher();
    d.dispatch({ ek_message_id: "a" });
    d.dispatch({ ek_message_id: "b" });

    const first = vi.fn();
    d.register(first);
    expect(first).toHaveBeenCalledTimes(2);

    const second = vi.fn();
    d.register(second);
    expect(second).not.toHaveBeenCalled();
  });

  it("caps the buffer so an app with no handler cannot grow it forever", () => {
    const d = new TapDispatcher();
    for (let i = 0; i < 20; i++) d.dispatch({ ek_message_id: String(i) });
    const handler = vi.fn();
    d.register(handler);
    expect(handler).toHaveBeenCalledTimes(5);
    // Oldest dropped, newest kept.
    expect(handler).toHaveBeenCalledWith({ ek_message_id: "19" });
    expect(handler).not.toHaveBeenCalledWith({ ek_message_id: "0" });
  });

  it("delivers to every registered handler", () => {
    const d = new TapDispatcher();
    const a = vi.fn();
    const b = vi.fn();
    d.register(a);
    d.register(b);
    d.dispatch({ ek_message_id: "m" });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", () => {
    const d = new TapDispatcher();
    const handler = vi.fn();
    const off = d.register(handler);
    off();
    d.dispatch({ ek_message_id: "m" });
    expect(handler).not.toHaveBeenCalled();
  });

  // A message listener that throws surfaces as an unhandled error and can stop
  // the others in the set.
  it("isolates a throwing handler from the rest", () => {
    const d = new TapDispatcher();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    d.register(bad);
    d.register(good);
    expect(() => d.dispatch({ ek_message_id: "m" })).not.toThrow();
    expect(good).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports whether the app has taken over routing", () => {
    const d = new TapDispatcher();
    expect(d.hasHandler).toBe(false);
    const off = d.register(vi.fn());
    expect(d.hasHandler).toBe(true);
    off();
    expect(d.hasHandler).toBe(false);
  });
});

describe("normalizeTapPayload", () => {
  it("accepts a plain object", () => {
    expect(normalizeTapPayload({ ek_url: "x" })).toEqual({ ek_url: "x" });
  });

  it("rejects anything that is not an object", () => {
    for (const bad of [null, undefined, "string", 42, [], true]) {
      expect(normalizeTapPayload(bad)).toBeNull();
    }
  });
});
