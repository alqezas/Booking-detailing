import { NextResponse, type NextRequest } from "next/server";
import { can, requireBusiness } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, zonedInstant } from "@/lib/format";

// CSV export. Permissions are checked on the server; RLS still applies to every row.
function csv(rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctx.params;
  const slug = request.nextUrl.searchParams.get("business") ?? "";
  const biz = await requireBusiness(slug);
  const supabase = await createClient();
  const tz = biz.settings.timezone;
  let body: string;

  if (kind === "payments") {
    if (!can(biz, "finance.export")) return new NextResponse("forbidden", { status: 403 });
    const from = request.nextUrl.searchParams.get("from") ?? "2000-01-01";
    const to = request.nextUrl.searchParams.get("to") ?? "2100-01-01";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new NextResponse("bad request", { status: 400 });
    const { data } = await supabase.from("payments").select("received_at, kind, amount, currency, reference, note, method:payment_methods(name), order:work_orders(number)")
      .eq("business_id", biz.id).gte("received_at", zonedInstant(from, 0, tz).toISOString()).lt("received_at", zonedInstant(addDays(to, 1), 0, tz).toISOString()).order("received_at");
    body = csv([["date", "kind", "amount", "currency", "method", "order", "reference", "note"],
      ...(data ?? []).map((p) => [p.received_at, p.kind, (p.amount / 100).toFixed(2), p.currency, p.method?.name ?? "", p.order?.number ?? "", p.reference, p.note])]);
  } else if (kind === "customers") {
    if (!can(biz, "customers.export")) return new NextResponse("forbidden", { status: 403 });
    const { data } = await supabase.from("customers").select("first_name, last_name, phone, email, locale, visits_count, total_spent, last_visit_at, created_at")
      .eq("business_id", biz.id).is("deleted_at", null).is("anonymized_at", null).order("created_at").limit(20000);
    body = csv([["first_name", "last_name", "phone", "email", "locale", "visits", "total_spent", "last_visit", "created"],
      ...(data ?? []).map((c) => [c.first_name, c.last_name, c.phone, c.email, c.locale, c.visits_count, (c.total_spent / 100).toFixed(2), c.last_visit_at, c.created_at])]);
  } else {
    return new NextResponse("not found", { status: 404 });
  }
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${biz.slug}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
