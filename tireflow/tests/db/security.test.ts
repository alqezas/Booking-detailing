import { describe, expect, it, beforeAll } from "vitest";
import { anon, as, DEMO, OTHER, type Client } from "./helpers";

describe("tenant isolation & RLS", () => {
  let owner: Client;
  let other: Client;
  beforeAll(async () => {
    owner = await as("owner");
    other = await as("other");
  });

  it("an owner sees only their own customers", async () => {
    const mine = await owner.from("customers").select("business_id");
    expect(mine.error).toBeNull();
    expect(mine.data!.length).toBeGreaterThanOrEqual(100);
    expect(new Set(mine.data!.map((r) => r.business_id))).toEqual(new Set([DEMO]));

    const theirs = await other.from("customers").select("business_id, first_name");
    expect(theirs.data!.every((r) => r.business_id === OTHER)).toBe(true);
    expect(theirs.data!.map((r) => r.first_name)).toContain("Secret");
  });

  it("filtering by another tenant's business_id returns nothing (no IDOR)", async () => {
    const r = await other.from("customers").select("id").eq("business_id", DEMO);
    expect(r.data).toEqual([]);
    const orders = await other.from("work_orders").select("id").eq("business_id", DEMO);
    expect(orders.data).toEqual([]);
  });

  it("cannot insert rows into another tenant", async () => {
    const r = await other.from("customers").insert({ business_id: DEMO, first_name: "Intruder" });
    expect(r.error).not.toBeNull();
  });

  it("cannot call another tenant's RPCs", async () => {
    const r = await other.rpc("dashboard_stats", { p_business: DEMO });
    expect(r.error?.message).toMatch(/forbidden/);
  });

  it("anonymous users cannot read any table", async () => {
    const a = anon();
    for (const t of ["customers", "bookings", "businesses", "payments", "work_orders"] as const) {
      const r = await a.from(t).select("id").limit(1);
      expect(r.data ?? []).toEqual([]);
    }
  });

  it("totals and payments cannot be edited directly", async () => {
    const { data: o } = await owner.from("work_orders").select("id,total").eq("business_id", DEMO).limit(1).single();
    const upd = await owner.from("work_orders").update({ total: 1 } as never).eq("id", o!.id);
    expect(upd.error).not.toBeNull();
    const pay = await owner.from("payments").insert({
      business_id: DEMO, work_order_id: o!.id, kind: "payment", amount: 1, currency: "CZK", method_id: o!.id,
    });
    expect(pay.error).not.toBeNull();
  });

  it("the super admin has no RLS access to tenant customers", async () => {
    const admin = await as("admin");
    const r = await admin.from("customers").select("id").limit(5);
    expect(r.data).toEqual([]);
    const list = await admin.rpc("admin_list_businesses");
    expect(list.error).toBeNull();
    expect(list.data!.map((b) => b.slug)).toContain("tireflow-demo");
  });

  it("non-admins cannot use super admin RPCs", async () => {
    const r = await owner.rpc("admin_list_businesses");
    expect(r.error?.message).toMatch(/forbidden/);
  });
});

describe("role permissions", () => {
  it("a mechanic cannot see payments or work order money", async () => {
    const mech = await as("mechanic");
    const pays = await mech.from("payments").select("id").limit(1);
    expect(pays.data).toEqual([]);
    const orders = await mech.from("work_orders").select("total").limit(1);
    expect(orders.data).toEqual([]);
    const work = await mech.rpc("my_work", { p_business: DEMO });
    expect(work.error).toBeNull();
    const list = work.data as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(0);
    expect(Object.keys(list[0])).not.toContain("total");
  });

  it("a mechanic's dashboard has no revenue figures", async () => {
    const mech = await as("mechanic");
    const r = await mech.rpc("dashboard_stats", { p_business: DEMO });
    expect(r.error).toBeNull();
    const s = r.data as Record<string, unknown>;
    expect(s.revenue_month).toBeNull();
    expect(s.bookings_today).not.toBeUndefined();
  });

  it("an accountant can read payments but cannot edit customers", async () => {
    const acc = await as("accountant");
    const pays = await acc.from("payments").select("id").limit(1);
    expect(pays.data!.length).toBe(1);
    const { data: c } = await acc.from("customers").select("id").limit(1).single();
    const upd = await acc.from("customers").update({ notes: "x" }).eq("id", c!.id).select();
    expect(upd.data ?? []).toEqual([]);
  });

  it("a mechanic cannot create bookings", async () => {
    const mech = await as("mechanic");
    const r = await mech.rpc("create_booking", { p_business: DEMO, p: {} });
    expect(r.error?.message).toMatch(/forbidden/);
  });
});
