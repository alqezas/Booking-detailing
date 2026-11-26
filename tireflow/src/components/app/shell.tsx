"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toggleTheme } from "./theme";
import { Check, ChevronsUpDown, Languages, LogOut, Menu, Moon, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { NavKey } from "@/lib/nav";
import { localeNames, locales } from "@/i18n/config";
import { setLocale, signOut } from "@/app/actions/auth";
import { navIcons } from "./nav-icons";
import { Logo } from "./logo";
import { CommandPalette } from "./command-palette";

type NavItem = { key: NavKey; href: string };
type Biz = { id: string; slug: string; name: string };

export function AppShell(props: {
  nav: NavItem[];
  business: Biz;
  businesses: Biz[];
  isAdmin: boolean;
  user: { email: string };
  children: React.ReactNode;
}) {
  // the menu belongs to the page it was opened on, so navigating closes it
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();
  const mobileOpen = menuPath === pathname;
  const setMobileOpen = (o: boolean) => setMenuPath(o ? pathname : null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-svh">
      <aside className="no-print sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <Sidebar {...props} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Sidebar {...props} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} onSearch={() => setPaletteOpen(true)} email={props.user.email} />
        <main className="flex-1 p-4 md:p-6">{props.children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} nav={props.nav} business={props.business} />
    </div>
  );
}

function Sidebar({ nav, business, businesses, isAdmin }: { nav: NavItem[]; business: Biz; businesses: Biz[]; isAdmin: boolean }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <Logo />
        {businesses.length > 1 || isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left text-sm font-medium hover:bg-sidebar-accent" />}>
              <span className="truncate">{business.name}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{tc("switchBusiness")}</DropdownMenuLabel>
                {businesses.map((b) => (
                  <DropdownMenuItem key={b.id} render={<Link href={`/app/${b.slug}/dashboard`} />}>
                    <span className="truncate">{b.name}</span>
                    {b.id === business.id && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href="/admin" />}>{t("admin")}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="truncate text-sm font-medium">{business.name}</span>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
        {nav.map((item) => {
          const Icon = navIcons[item.key];
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                active && "bg-sidebar-accent font-medium text-sidebar-foreground",
              )}
            >
              <Icon className="size-4" />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function TopBar({ onMenu, onSearch, email }: { onMenu: () => void; onSearch: () => void; email: string }) {
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Menu">
        <Menu />
      </Button>
      <button
        onClick={onSearch}
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-sm text-muted-foreground hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="truncate">{tc("commandHint")}</span>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={tc("theme")} onClick={toggleTheme}>
          <Sun className="hidden dark:block" /><Moon className="dark:hidden" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="max-w-48" />}>
            <span className="truncate">{email}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Languages className="size-4" />{tc("language")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {locales.map((l) => (
                  <DropdownMenuItem key={l} onClick={() => startTransition(async () => { await setLocale(l); router.refresh(); })}>
                    {localeNames[l]}
                    {l === locale && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => startTransition(() => signOut())}>
              <LogOut className="size-4" />{tc("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
