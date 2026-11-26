import type { BusinessContext, ModuleKey } from "@/lib/auth";

export type NavKey =
  | "dashboard" | "calendar" | "orders" | "customers" | "vehicles" | "tireHotel" | "inventory"
  | "services" | "employees" | "finance" | "analytics" | "notifications" | "settings" | "myWork";

type NavDef = { key: NavKey; path: string; module?: ModuleKey; perm?: string; anyPerm?: string[] };

const NAV: NavDef[] = [
  { key: "dashboard", path: "dashboard", perm: "calendar.view" },
  { key: "myWork", path: "my-work", perm: "orders.work" },
  { key: "calendar", path: "calendar", module: "calendar", perm: "calendar.view" },
  { key: "orders", path: "orders", module: "orders", perm: "orders.view_all" },
  { key: "customers", path: "customers", module: "customers", perm: "customers.view" },
  { key: "vehicles", path: "vehicles", module: "vehicles", perm: "customers.view" },
  { key: "tireHotel", path: "tire-hotel", module: "tire_hotel", perm: "tire_hotel.view" },
  { key: "inventory", path: "inventory", module: "inventory", perm: "inventory.view" },
  { key: "services", path: "services", module: "services", anyPerm: ["services.manage", "calendar.manage"] },
  { key: "employees", path: "employees", module: "employees", perm: "employees.view" },
  { key: "finance", path: "finance", module: "finance", anyPerm: ["finance.view", "finance.manage"] },
  { key: "analytics", path: "analytics", module: "analytics", perm: "analytics.view" },
  { key: "notifications", path: "notifications", module: "notifications", perm: "notifications.manage" },
  { key: "settings", path: "settings", perm: "business.manage" },
];

export function buildNav(ctx: BusinessContext) {
  return NAV.filter((n) =>
    (!n.module || ctx.modules.includes(n.module)) &&
    (!n.perm || ctx.permissions.includes(n.perm)) &&
    (!n.anyPerm || n.anyPerm.some((p) => ctx.permissions.includes(p))) &&
    // owners/managers do not need a separate "my work" page
    !(n.key === "myWork" && ctx.permissions.includes("orders.view_all")),
  ).map((n) => ({ key: n.key, href: `/app/${ctx.slug}/${n.path}` }));
}
