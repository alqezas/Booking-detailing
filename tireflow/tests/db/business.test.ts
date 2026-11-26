import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { anon, as, DEMO, futureSlot, service, type Client } from "./helpers";

const run = Math.floor(Math.random() * 1e9).toString(36);
// book far from the seeded week so runs never collide with demo data
const dayOffset = 25 + Math.floor(Math.random() * 25);

let owner: Client;
let branch: string;
let post1: string;
let seasonal: string;
let mounting: string;
let customer: string;
let cash: string;
const created = { bookings: [] as string[], customers: [] as string[] };

beforeAll(async () => {
  owner = await as("owner");
  const br = await owner.from("branches").select("id").eq("business_id", DEMO).order("sort_order").limit(1).single();
  branch = br.data!.id;
  const ws = await owner.from("workstations").select("id").eq("branch_id", branch).order("sort_order").limit(1).single();
  post1 = ws.data!.id;
  const svc = await owner.from("services").select("id,name").eq("business_id", DEMO);
  seasonal = svc.data!.find((s) => s.name.startsWith("Seasonal"))!.id;
  mounting = svc.data!.find((s) => s.name.startsWith("Tire mounting"))!.id;
  const c = await owner.from("customers").select("id").eq("business_id", DEMO).limit(1).single();
  customer = c.data!.id;
  const m = await owner.from("payment_methods").select("id").eq("business_id", DEMO).eq("code", "cash").single();
  cash = m.data!.id;
});

afterAll(async () => {
  const s = service();
  if (created.bookings.length) {
    await s.from("notification_jobs").delete().in("entity_id", created.bookings);
    await s.from("bookings").delete().in("id", created.bookings);
  }
});

describe("pricing", () => {
  it("quotes by vehicle parameters on the server", async () => {
    const base = await owner.rpc("quote_services", { p_business: DEMO, p_services: [mounting], p_params: { rim: 16, wheel_count: 4 } });
    const big = await owner.rpc("quote_services", { p_business: DEMO, p_services: [mounting], p_params: { rim: 18, runflat: true, wheel_count: 4 } });
    // 4 × 250 Kč vs 4 × (250 + 50 R17-18 + 150 RunFlat)
    expect((base.data as any).total).toBe(100000);
    expect((big.data as any).total).toBe(180000);
    expect((big.data as any).duration_min).toBe(60);
  });
});

describe("bookings", () => {
  it("creates a booking and blocks the post", async () => {
    const starts = futureSlot(dayOffset, 9);
    const r = await owner.rpc("create_booking", {
      p_business: DEMO,
      p: { branch_id: branch, workstation_id: post1, customer_id: customer, starts_at: starts, service_ids: [seasonal] },
      p_idempotency_key: `t-${run}-1`,
    });
    expect(r.error).toBeNull();
    created.bookings.push(r.data!);
    const again = await owner.rpc("create_booking", {
      p_business: DEMO,
      p: { branch_id: branch, workstation_id: post1, customer_id: customer, starts_at: starts, service_ids: [seasonal] },
      p_idempotency_key: `t-${run}-1`,
    });
    expect(again.data).toBe(r.data); // idempotent retry returns the same booking
  });

  it("rejects a concurrent double booking of the same post", async () => {
    const starts = futureSlot(dayOffset, 11);
    const [a, b] = await Promise.all([owner, await as("manager")].map((c) =>
      c.rpc("create_booking", {
        p_business: DEMO,
        p: { branch_id: branch, workstation_id: post1, customer_id: customer, starts_at: starts, service_ids: [seasonal] },
      })));
    const ok = [a, b].filter((x) => !x.error);
    const failed = [a, b].filter((x) => x.error);
    expect(ok).toHaveLength(1);
    expect(failed[0].error!.message).toMatch(/slot_taken/);
    created.bookings.push(ok[0].data!);
  });

  it("reschedules, and refuses to move onto a busy slot", async () => {
    const first = await owner.rpc("create_booking", {
      p_business: DEMO, p: { branch_id: branch, workstation_id: post1, starts_at: futureSlot(dayOffset, 13), service_ids: [seasonal] },
    });
    const second = await owner.rpc("create_booking", {
      p_business: DEMO, p: { branch_id: branch, workstation_id: post1, starts_at: futureSlot(dayOffset, 14), service_ids: [seasonal] },
    });
    created.bookings.push(first.data!, second.data!);
    const clash = await owner.rpc("reschedule_booking", { p_business: DEMO, p_booking: second.data!, p_starts_at: futureSlot(dayOffset, 13, 15) });
    expect(clash.error?.message).toMatch(/slot_taken/);
    const ok = await owner.rpc("reschedule_booking", { p_business: DEMO, p_booking: second.data!, p_starts_at: futureSlot(dayOffset, 15) });
    expect(ok.error).toBeNull();
  });

  it("cancelling frees the slot", async () => {
    const starts = futureSlot(dayOffset, 16);
    const b1 = await owner.rpc("create_booking", { p_business: DEMO, p: { branch_id: branch, workstation_id: post1, starts_at: starts, service_ids: [seasonal] } });
    created.bookings.push(b1.data!);
    await owner.rpc("set_booking_status", { p_business: DEMO, p_booking: b1.data!, p_status: "cancelled" });
    const b2 = await owner.rpc("create_booking", { p_business: DEMO, p: { branch_id: branch, workstation_id: post1, starts_at: starts, service_ids: [seasonal] } });
    expect(b2.error).toBeNull();
    created.bookings.push(b2.data!);
  });

  it("queues a confirmation once and never twice", async () => {
    const r = await owner.rpc("create_booking", {
      p_business: DEMO, p: { branch_id: branch, workstation_id: post1, customer_id: customer, starts_at: futureSlot(dayOffset, 8), service_ids: [seasonal] },
    });
    created.bookings.push(r.data!);
    const s = service();
    const jobs = await s.from("notification_jobs").select("event, dedupe_key").eq("entity_id", r.data!);
    const confirmed = jobs.data!.filter((j) => j.event === "booking_confirmed");
    expect(confirmed).toHaveLength(1);
    // the same event for the same booking state is ignored by the dedupe key
    const dup = await s.from("notification_jobs").insert({
      business_id: DEMO, event: "booking_confirmed", channel: "sms", recipient: "+420", body: "x", dedupe_key: confirmed[0].dedupe_key,
    });
    expect(dup.error?.code).toBe("23505");
  });
});

describe("public booking", () => {
  it("lets a visitor book without an account and manage it by link", async () => {
    const a = anon();
    const biz = await a.rpc("public_business", { p_slug: "tireflow-demo" });
    expect(biz.error).toBeNull();
    const info = biz.data as any;
    const day = futureSlot(dayOffset + 1, 12).slice(0, 10);
    const slots = await a.rpc("public_slots", {
      p_slug: "tireflow-demo", p_branch: info.branches[0].id, p_day: day, p_services: [seasonal], p_params: { rim: 16 },
    });
    expect(slots.error).toBeNull();
    expect(slots.data!.length).toBeGreaterThan(0);

    const booked = await a.rpc("public_create_booking", {
      p_slug: "tireflow-demo",
      p: {
        branch_id: info.branches[0].id, service_ids: [seasonal], vehicle_params: { rim: 16 },
        starts_at: slots.data![0].starts_at, first_name: "Test", last_name: run, phone: `+420 600 ${String(Date.now()).slice(-6)}`,
        plate: `T${run.slice(0, 5)}`, client_fingerprint: run,
      },
    });
    expect(booked.error).toBeNull();
    const { booking_id, token } = booked.data as any;
    created.bookings.push(booking_id);
    expect(token).toHaveLength(48);

    const view = await a.rpc("public_booking", { p_token: token });
    expect((view.data as any).status).toBe("confirmed");
    expect((await a.rpc("public_booking", { p_token: "0".repeat(48) })).data).toBeNull();

    const cancel = await a.rpc("public_cancel_booking", { p_token: token });
    expect(cancel.error).toBeNull();
    expect(((await a.rpc("public_booking", { p_token: token })).data as any).status).toBe("cancelled");
  });

  it("rejects a service that is not bookable online", async () => {
    const a = anon();
    const { data: rims } = await owner.from("services").select("id").eq("business_id", DEMO).eq("online_bookable", false).limit(1).single();
    const r = await a.rpc("public_quote", { p_slug: "tireflow-demo", p_services: [rims!.id], p_params: {} });
    expect(r.error?.message).toMatch(/service_not_bookable/);
  });
});

describe("work orders, stock and payments", () => {
  it("completes an order, consumes stock, and tracks partial payment + refund", async () => {
    const { data: wh } = await owner.from("warehouses").select("id").eq("business_id", DEMO).eq("purpose", "stock").order("name", { ascending: false }).limit(1).single();
    const { data: stock } = await owner.from("inventory_stock").select("product_id, on_hand").eq("warehouse_id", wh!.id).gt("on_hand", 10).limit(1).single();

    const o = await owner.rpc("create_work_order", {
      p_business: DEMO, p: { branch_id: branch, customer_id: customer, service_ids: [mounting], vehicle_params: { rim: 16, wheel_count: 4 } },
    });
    expect(o.error).toBeNull();
    const add = await owner.rpc("add_work_order_item", {
      p_business: DEMO, p_order: o.data!, p: { kind: "product", product_id: stock!.product_id, warehouse_id: wh!.id, quantity: 2 },
    });
    expect(add.error).toBeNull();

    const { data: order } = await owner.from("work_orders").select("total, tax_total, payment_status").eq("id", o.data!).single();
    expect(order!.total).toBeGreaterThan(100000);
    expect(order!.payment_status).toBe("unpaid");

    const p1 = await owner.rpc("record_payment", { p_business: DEMO, p_order: o.data!, p_amount: 50000, p_method: cash, p_idempotency_key: `pay-${run}` });
    const p1again = await owner.rpc("record_payment", { p_business: DEMO, p_order: o.data!, p_amount: 50000, p_method: cash, p_idempotency_key: `pay-${run}` });
    expect(p1again.data).toBe(p1.data);
    expect((await owner.from("work_orders").select("payment_status").eq("id", o.data!).single()).data!.payment_status).toBe("partial");

    await owner.rpc("record_payment", { p_business: DEMO, p_order: o.data!, p_amount: order!.total - 50000, p_method: cash });
    expect((await owner.from("work_orders").select("payment_status").eq("id", o.data!).single()).data!.payment_status).toBe("paid");

    const tooMuch = await owner.rpc("refund_payment", { p_business: DEMO, p_payment: p1.data!, p_amount: 60000, p_reason: "test" });
    expect(tooMuch.error?.message).toMatch(/refund_exceeds_payment/);
    const refund = await owner.rpc("refund_payment", { p_business: DEMO, p_payment: p1.data!, p_amount: 10000, p_reason: "goodwill" });
    expect(refund.error).toBeNull();
    expect((await owner.from("work_orders").select("payment_status, paid_total").eq("id", o.data!).single()).data).toEqual({
      payment_status: "partial", paid_total: order!.total - 10000,
    });

    const done = await owner.rpc("set_work_order_status", { p_business: DEMO, p_order: o.data!, p_status: "completed" });
    expect(done.error).toBeNull();
    const { data: after } = await owner.from("inventory_stock").select("on_hand").eq("warehouse_id", wh!.id).eq("product_id", stock!.product_id).single();
    expect(Number(after!.on_hand)).toBe(Number(stock!.on_hand) - 2);
  });

  it("never lets stock go negative", async () => {
    const { data: wh } = await owner.from("warehouses").select("id").eq("business_id", DEMO).eq("purpose", "stock").limit(1).single();
    const { data: p } = await owner.from("products").select("id").eq("business_id", DEMO).limit(1).single();
    const r = await owner.rpc("record_inventory_movement", { p_business: DEMO, p_product: p!.id, p_warehouse: wh!.id, p_kind: "issue", p_quantity: 100000 });
    expect(r.error?.message).toMatch(/insufficient_stock/);
  });

  it("exact money: tax included is split without losing a cent", async () => {
    const o = await owner.rpc("create_work_order", { p_business: DEMO, p: { branch_id: branch, service_ids: [seasonal] } });
    const { data } = await owner.from("work_order_items").select("line_total, line_tax, unit_price").eq("work_order_id", o.data!).single();
    // 600.00 Kč incl. 21 % VAT → tax = round(60000 × 21 / 121) = 10413
    expect(data).toEqual({ unit_price: 60000, line_total: 60000, line_tax: 10413 });
    await owner.rpc("set_work_order_status", { p_business: DEMO, p_order: o.data!, p_status: "cancelled" });
  });
});

describe("tire hotel", () => {
  it("checks in, refuses an over-full cell, and releases", async () => {
    const { data: hotel } = await owner.from("warehouses").select("id").eq("business_id", DEMO).eq("purpose", "tire_hotel").single();
    const r = await owner.rpc("check_in_tire_set", {
      p_business: DEMO,
      p: {
        customer_id: customer, warehouse_id: hotel!.id, season: "winter", width: 205, profile: 55, diameter: 16,
        items: [{ position: "FL", dot: "1223", tread_mm: 6.5 }, { position: "FR", dot: "1223", tread_mm: 6.4 }],
        payment: { amount: 150000, method_id: cash },
      },
      p_idempotency_key: `hotel-${run}`,
    });
    expect(r.error).toBeNull();
    const res = r.data as any;
    expect(res.location_code).toMatch(/^[A-Z]-\d{2}-\d{2}-\d{2}$/);

    const { data: set } = await owner.from("tire_sets").select("location_id").eq("id", res.tire_set_id).single();
    // the cell holds one set: a second set into the same cell must fail
    const full = await owner.rpc("check_in_tire_set", {
      p_business: DEMO, p: { customer_id: customer, location_id: set!.location_id, season: "summer" },
    });
    expect(full.error?.message).toMatch(/location_full/);

    const out = await owner.rpc("release_tire_set", { p_business: DEMO, p_set: res.tire_set_id });
    expect(out.error).toBeNull();
    const { data: cell } = await owner.from("storage_locations").select("occupied_sets").eq("id", set!.location_id!).single();
    expect(cell!.occupied_sets).toBe(0);
  });

  it("refuses to release unpaid storage unless allowed", async () => {
    const { data: unpaid } = await owner.from("tire_storage_contracts").select("tire_set_id, paid_total, price")
      .eq("business_id", DEMO).eq("status", "active").eq("paid_total", 0).limit(1).single();
    const r = await owner.rpc("release_tire_set", { p_business: DEMO, p_set: unpaid!.tire_set_id });
    expect(r.error?.message).toMatch(/storage_unpaid/);
  });
});
