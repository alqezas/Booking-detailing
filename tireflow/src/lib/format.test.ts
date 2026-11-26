import { describe, expect, it } from "vitest";
import { addDays, formatMoney, parseMoney, rpcErrorKey, zonedInstant, zonedMinutes } from "./format";

describe("money", () => {
  it("parses decimal input into exact minor units", () => {
    expect(parseMoney("600")).toBe(60000);
    expect(parseMoney("1 234,5")).toBe(123450);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("19.99")).toBe(1999);
    expect(parseMoney("1.999")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
  it("never uses floating point for sums", () => {
    // 0.1 + 0.2 in minor units is exact
    expect(parseMoney("0.1")! + parseMoney("0.2")!).toBe(30);
  });
  it("formats per currency and locale", () => {
    expect(formatMoney(60000, "CZK", "cs")).toMatch(/600\s?Kč/);
    expect(formatMoney(1999, "EUR", "de")).toMatch(/19,99/);
    expect(formatMoney(null, "PLN")).toBe("—");
  });
});

describe("time zones", () => {
  it("builds instants on DST days correctly", () => {
    // 2026-03-29: Prague switches to CEST at 02:00
    expect(zonedInstant("2026-03-29", 9 * 60, "Europe/Prague").toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(zonedInstant("2026-01-15", 9 * 60, "Europe/Prague").toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(zonedInstant("2026-07-01", 8 * 60, "Europe/Kyiv").toISOString()).toBe("2026-07-01T05:00:00.000Z");
  });
  it("reads local minutes", () => {
    expect(zonedMinutes(new Date("2026-01-15T08:30:00Z"), "Europe/Prague")).toBe(570);
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("rpc errors", () => {
  it("maps database errors to translation keys", () => {
    expect(rpcErrorKey("slot_taken")).toBe("slot_taken");
    expect(rpcErrorKey("forbidden: calendar.manage")).toBe("forbidden");
    expect(rpcErrorKey("weird")).toBe("generic");
  });
});
