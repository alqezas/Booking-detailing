import { describe, expect, it } from "vitest";
import { as, DEMO, OTHER, service } from "./helpers";

describe("notification queue", () => {
  it("claims each job once, retries with backoff, then dead-letters", async () => {
    const s = service();
    const key = `test-queue-${crypto.randomUUID()}`;
    const { data: job } = await s.from("notification_jobs").insert({
      business_id: DEMO, event: "booking_confirmed", channel: "sms", recipient: "+420600000000", body: "hi",
      dedupe_key: key, max_attempts: 2, run_at: new Date(Date.now() - 1000).toISOString(),
    }).select("id").single();

    // two workers race: the job is handed out exactly once
    const [a, b] = await Promise.all([
      s.rpc("claim_notification_jobs", { p_worker: "w1", p_limit: 200 }),
      s.rpc("claim_notification_jobs", { p_worker: "w2", p_limit: 200 }),
    ]);
    const claimed = [...(a.data ?? []), ...(b.data ?? [])].filter((j) => j.id === job!.id);
    expect(claimed).toHaveLength(1);

    await s.rpc("complete_notification_job", { p_job: job!.id, p_ok: false, p_provider: "test", p_detail: "timeout", p_retryable: true });
    const { data: retry } = await s.from("notification_jobs").select("status, attempts, run_at").eq("id", job!.id).single();
    expect(retry!.status).toBe("queued");
    expect(new Date(retry!.run_at).getTime()).toBeGreaterThan(Date.now()); // backoff pushed it into the future

    // force due, claim again, fail again → max_attempts reached → dead
    await s.from("notification_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() }).eq("id", job!.id);
    await s.rpc("claim_notification_jobs", { p_worker: "w3", p_limit: 200 });
    await s.rpc("complete_notification_job", { p_job: job!.id, p_ok: false, p_provider: "test", p_detail: "timeout", p_retryable: true });
    const { data: dead } = await s.from("notification_jobs").select("status, attempts").eq("id", job!.id).single();
    expect(dead).toEqual({ status: "dead", attempts: 2 });
    await s.from("notification_jobs").delete().eq("id", job!.id);
  });

  it("staff cannot call the worker RPCs", async () => {
    const owner = await as("owner");
    const r = await owner.rpc("claim_notification_jobs", { p_worker: "x", p_limit: 1 });
    expect(r.error).not.toBeNull();
  });
});

describe("cross-tenant references", () => {
  it("a row of one business can never point at another business' row", async () => {
    const s = service();
    const { data: demoCustomer } = await s.from("customers").select("id").eq("business_id", DEMO).limit(1).single();
    // even with the secret key (bypassing RLS) the composite FK rejects it
    const r = await s.from("vehicles").insert({ business_id: OTHER, customer_id: demoCustomer!.id, make: "Test" });
    expect(r.error?.code).toBe("23503");
  });
});
