import {
  BarChart3, Bell, Boxes, CalendarDays, Car, CircleDot, ClipboardList, LayoutDashboard, Settings,
  Tags, Users, UserCog, Wallet, Wrench,
} from "lucide-react";
import type { NavKey } from "@/lib/nav";

export const navIcons: Record<NavKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  myWork: Wrench,
  calendar: CalendarDays,
  orders: ClipboardList,
  customers: Users,
  vehicles: Car,
  tireHotel: CircleDot,
  inventory: Boxes,
  services: Tags,
  employees: UserCog,
  finance: Wallet,
  analytics: BarChart3,
  notifications: Bell,
  settings: Settings,
};
