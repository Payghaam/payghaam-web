import { describe, expect, it } from "vitest";
import {
  serializeSubscription,
  uint8ArrayToUrlBase64,
  urlBase64ToUint8Array,
} from "./vapid.js";

/** A real 65-byte uncompressed P-256 point, base64url with no padding. */
const VALID_KEY =
  "BCNlI-ggcssNpOs1tdX_kd-8hvVa5lccuNy1Pa9hgtU2xXmom_Ne4eq154BE7GaAVjj__RZAEv5uRKWettd0UQ4";

describe("urlBase64ToUint8Array", () => {
  it("decodes a VAPID public key to the 65 bytes subscribe() expects", () => {
    const bytes = urlBase64ToUint8Array(VALID_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    // Uncompressed EC points always start with 0x04.
    expect(bytes[0]).toBe(0x04);
  });

  // The whole reason this function exists: browsers emit base64url, atob only
  // speaks padded standard base64.
  it("translates the base64url alphabet and restores padding", () => {
    expect(() => urlBase64ToUint8Array(VALID_KEY)).not.toThrow();
    expect(VALID_KEY).toContain("-");
    expect(VALID_KEY).toContain("_");
    expect(VALID_KEY).not.toContain("=");
  });

  it("tolerates surrounding whitespace from a copy-paste", () => {
    expect(urlBase64ToUint8Array(`  ${VALID_KEY}\n`).length).toBe(65);
  });

  it("rejects an empty key", () => {
    expect(() => urlBase64ToUint8Array("")).toThrow(/empty/i);
    expect(() => urlBase64ToUint8Array("   ")).toThrow(/empty/i);
  });

  it("rejects a key that is not valid base64url", () => {
    expect(() => urlBase64ToUint8Array("!!!not base64!!!")).toThrow(/base64url/i);
  });

  // A truncated key does not throw at subscribe() — it produces a subscription
  // the push service later rejects with a 401 that reads like a server-side
  // misconfiguration. Failing here points at the real cause.
  it("rejects a truncated key rather than letting it fail later as a 401", () => {
    const truncated = VALID_KEY.slice(0, 40);
    expect(() => urlBase64ToUint8Array(truncated)).toThrow(/65 bytes/);
  });
});

describe("uint8ArrayToUrlBase64", () => {
  it("round-trips through the base64url alphabet", () => {
    const bytes = urlBase64ToUint8Array(VALID_KEY);
    expect(uint8ArrayToUrlBase64(bytes.buffer as ArrayBuffer)).toBe(VALID_KEY);
  });

  it("emits no padding and no standard-base64 characters", () => {
    const out = uint8ArrayToUrlBase64(new Uint8Array([251, 255, 254]).buffer);
    expect(out).not.toContain("=");
    expect(out).not.toContain("+");
    expect(out).not.toContain("/");
  });

  it("returns an empty string for a null key", () => {
    expect(uint8ArrayToUrlBase64(null)).toBe("");
  });
});

describe("serializeSubscription", () => {
  const keys: Record<string, ArrayBuffer> = {
    p256dh: new Uint8Array([1, 2, 3]).buffer,
    auth: new Uint8Array([4, 5, 6]).buffer,
  };
  const sub = (over: Partial<{ endpoint: string; p256dh: unknown; auth: unknown }> = {}) => ({
    endpoint: over.endpoint ?? "https://web.push.apple.com/QF123",
    getKey(name: "p256dh" | "auth"): ArrayBuffer | null {
      const v = name === "p256dh" ? over.p256dh : over.auth;
      if (v === null) return null;
      return (v as ArrayBuffer) ?? (keys[name] as ArrayBuffer);
    },
  });

  it("flattens a PushSubscription into the three values the API stores", () => {
    const out = serializeSubscription(sub());
    expect(out).toEqual({
      endpoint: "https://web.push.apple.com/QF123",
      p256dh: uint8ArrayToUrlBase64(keys.p256dh as ArrayBuffer),
      auth: uint8ArrayToUrlBase64(keys.auth as ArrayBuffer),
    });
  });

  // getKey() is specified to be nullable. A row saved without both keys can
  // never be encrypted to, so the subscriber silently receives nothing forever.
  it("returns null when either key is absent", () => {
    expect(serializeSubscription(sub({ p256dh: null }))).toBeNull();
    expect(serializeSubscription(sub({ auth: null }))).toBeNull();
  });

  it("returns null for a blank endpoint", () => {
    expect(serializeSubscription(sub({ endpoint: "   " }))).toBeNull();
  });

  it("keeps a long Apple endpoint intact", () => {
    const long = `https://web.push.apple.com/${"Q".repeat(300)}`;
    expect(serializeSubscription(sub({ endpoint: long }))?.endpoint).toBe(long);
  });
});
