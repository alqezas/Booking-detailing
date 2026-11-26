"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, NativeSelect, Section } from "@/components/app/ui";
import { useActionToast } from "@/components/app/form-bits";
import { createClient } from "@/lib/supabase/client";
import { localeNames, locales } from "@/i18n/config";
import { inviteMember, saveBranch, savePost, saveSettings, setLogo, toggleModule } from "./actions";

type General = Record<string, string | boolean>;
type Branch = { id: string; name: string; address_line: string; city: string; postal_code: string; country: string; phone: string; opening_hours: Record<string, [string, string][]> };
type Post = { id: string; name: string; kind: string; equipment: string; is_active: boolean; branch_id: string };
const TZ = ["Europe/Prague", "Europe/Warsaw", "Europe/Kyiv", "Europe/Bratislava", "Europe/Vienna", "Europe/Berlin"];
const DAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

export function SettingsTabs(props: {
  slug: string; businessId: string; supabaseUrl: string; canMembers: boolean; general: General; logoPath: string | null;
  modules: { module: string; enabled: boolean }[]; branches: Branch[]; posts: Post[];
  members: { id: string; role: string; active: boolean; name: string }[]; employees: { id: string; name: string }[];
}) {
  const t = useTranslations("settings");
  return (
    <Tabs defaultValue="business">
      <TabsList className="mb-4 flex-wrap">
        <TabsTrigger value="business">{t("business")}</TabsTrigger>
        <TabsTrigger value="booking">{t("booking")}</TabsTrigger>
        <TabsTrigger value="modules">{t("modules")}</TabsTrigger>
        <TabsTrigger value="branches">{t("branches")}</TabsTrigger>
        <TabsTrigger value="posts">{t("posts")}</TabsTrigger>
        {props.canMembers && <TabsTrigger value="team">{t("team")}</TabsTrigger>}
      </TabsList>
      <GeneralForms {...props} />
      <TabsContent value="modules"><Modules {...props} /></TabsContent>
      <TabsContent value="branches"><Branches {...props} /></TabsContent>
      <TabsContent value="posts"><Posts {...props} /></TabsContent>
      {props.canMembers && <TabsContent value="team"><Team {...props} /></TabsContent>}
    </Tabs>
  );
}

function GeneralForms({ slug, general, businessId, logoPath, supabaseUrl }: Parameters<typeof SettingsTabs>[0]) {
  const t = useTranslations("settings");
  const tcal = useTranslations("calendar");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const { register, handleSubmit, watch } = useForm({ defaultValues: general });
  const submit = handleSubmit((v) => start(async () => { if (toastResult(await saveSettings(slug, v))) router.refresh(); }));
  const [logo, setLogoState] = useState(logoPath);

  const upload = async (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type) || file.size > 2_000_000) return toast.error(tc("error"));
    const ext = file.type.split("/")[1].replace("svg+xml", "svg");
    const path = `${businessId}/logo/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("public-assets").upload(path, file, { contentType: file.type, upsert: false });
    if (error) return toast.error(tc("error"));
    if (toastResult(await setLogo(slug, path))) { setLogoState(path); router.refresh(); }
  };

  return (
    <>
      <TabsContent value="business">
        <form onSubmit={submit} className="max-w-3xl space-y-4">
          <Section title={t("business")}>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label={tc("name")}><Input {...register("name")} /></Field>
              <Field label="VAT ID"><Input {...register("tax_id")} /></Field>
              <Field label={tc("email")}><Input type="email" {...register("email")} /></Field>
              <Field label={tc("phone")}><Input {...register("phone")} /></Field>
              <Field label="Web"><Input {...register("website")} placeholder="https://" /></Field>
              <Field label={t("currency")}><NativeSelect {...register("currency")}>{["CZK", "EUR", "PLN", "UAH"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
              <Field label={t("crmLocale")}><NativeSelect {...register("crm_locale")}>{locales.map((l) => <option key={l} value={l}>{localeNames[l]}</option>)}</NativeSelect></Field>
              <Field label={t("publicLocale")}><NativeSelect {...register("public_locale")}>{locales.map((l) => <option key={l} value={l}>{localeNames[l]}</option>)}</NativeSelect></Field>
              <Field label={t("timezone")}><NativeSelect {...register("timezone")}>{TZ.map((z) => <option key={z}>{z}</option>)}</NativeSelect></Field>
              <Field label={t("taxRate")}><Input inputMode="decimal" {...register("tax_pct")} /></Field>
              <Field label={t("storagePrice")}><Input inputMode="decimal" {...register("storage_price")} /></Field>
              <Field label="Order prefix"><Input {...register("order_number_prefix")} maxLength={8} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("prices_include_tax")} />{t("pricesIncludeTax")}</label>
            </div>
          </Section>
          <Section title={t("branding")}>
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              <Field label={t("brandColor")}><Input type="color" {...register("brand_color")} className="h-9 p-1" /></Field>
              <Field label={t("accentColor")}><Input type="color" {...register("accent_color")} className="h-9 p-1" /></Field>
              <Field label={t("logo")}>
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logo && <img src={`${supabaseUrl}/storage/v1/object/public/public-assets/${logo}`} alt="" className="size-9 rounded object-contain" />}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-xs" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </div>
              </Field>
              <div className="flex items-center gap-2 text-sm sm:col-span-3">
                <span className="inline-block h-8 w-24 rounded" style={{ background: String(watch("brand_color")) }} />
                <span className="inline-block h-8 w-24 rounded" style={{ background: String(watch("accent_color")) }} />
              </div>
            </div>
          </Section>
          <Button type="submit" disabled={pending}>{tc("save")}</Button>
        </form>
      </TabsContent>
      <TabsContent value="booking">
        <form onSubmit={submit} className="max-w-3xl space-y-4">
          <Section title={t("booking")}>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label={t("slotStep")}><NativeSelect {...register("slot_step_minutes")}>{[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></Field>
              <Field label={t("leadTime")}><Input type="number" {...register("booking_lead_minutes")} /></Field>
              <Field label={t("horizon")}><Input type="number" {...register("booking_horizon_days")} /></Field>
              <Field label={t("cancelUntil")}><Input type="number" {...register("booking_cancel_until_minutes")} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("booking_requires_confirmation")} />{t("requireConfirm")}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("seasonal_mode")} />{tcal("seasonalMode")}</label>
            </div>
          </Section>
          <Button type="submit" disabled={pending}>{tc("save")}</Button>
        </form>
      </TabsContent>
    </>
  );
}

function Modules({ slug, modules }: Parameters<typeof SettingsTabs>[0]) {
  const t = useTranslations("settings");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  return (
    <Section title={t("modules")} className="max-w-xl">
      <ul className="divide-y text-sm">
        {modules.map((m) => (
          <li key={m.module} className="flex items-center justify-between px-4 py-2">
            <span>{t(`moduleNames.${m.module}` as "moduleNames.calendar")}</span>
            <input type="checkbox" className="size-4" defaultChecked={m.enabled} disabled={pending}
              onChange={(e) => start(async () => { if (toastResult(await toggleModule(slug, m.module, e.target.checked))) router.refresh(); })} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Branches({ slug, branches }: Parameters<typeof SettingsTabs>[0]) {
  const t = useTranslations("settings");
  const empty: Branch = { id: "", name: "", address_line: "", city: "", postal_code: "", country: "CZ", phone: "", opening_hours: { 1: [["08:00", "18:00"]], 2: [["08:00", "18:00"]], 3: [["08:00", "18:00"]], 4: [["08:00", "18:00"]], 5: [["08:00", "18:00"]], 6: [], 7: [] } };
  const [adding, setAdding] = useState(false);
  return (
    <div className="max-w-3xl space-y-4">
      {branches.map((b) => <BranchForm key={b.id} slug={slug} branch={b} />)}
      {adding ? <BranchForm slug={slug} branch={empty} onDone={() => setAdding(false)} /> : <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus />{t("newBranch")}</Button>}
    </div>
  );
}

function BranchForm({ slug, branch, onDone }: { slug: string; branch: Branch; onDone?: () => void }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tp = useTranslations("public");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [b, setB] = useState(branch);
  const hours = (d: string) => (b.opening_hours[d]?.[0] ? b.opening_hours[d][0] : ["", ""]);
  const setHours = (d: string, i: 0 | 1, v: string) => {
    const cur = [...hours(d)] as [string, string];
    cur[i] = v;
    setB({ ...b, opening_hours: { ...b.opening_hours, [d]: cur[0] && cur[1] ? [cur] : [] } });
  };
  return (
    <Section title={b.name || t("newBranch")}>
      <form className="grid gap-3 p-4 sm:grid-cols-3" onSubmit={(e) => {
        e.preventDefault();
        start(async () => { if (toastResult(await saveBranch(slug, b.id || null, b))) { onDone?.(); router.refresh(); } });
      }}>
        <Field label={tc("name")}><Input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} required /></Field>
        <Field label={t("address")}><Input value={b.address_line} onChange={(e) => setB({ ...b, address_line: e.target.value })} /></Field>
        <Field label={t("city")}><Input value={b.city} onChange={(e) => setB({ ...b, city: e.target.value })} /></Field>
        <Field label="PSČ / PLZ"><Input value={b.postal_code} onChange={(e) => setB({ ...b, postal_code: e.target.value })} /></Field>
        <Field label="Country"><NativeSelect value={b.country} onChange={(e) => setB({ ...b, country: e.target.value })}>{["CZ", "PL", "UA", "SK", "AT", "DE"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
        <Field label={tc("phone")}><Input value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} /></Field>
        <div className="sm:col-span-3">
          <div className="mb-1 text-sm font-medium">{t("hours")}</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {DAYS.map((d) => (
              <div key={d} className="flex items-center gap-2 text-sm">
                <span className="w-8 text-muted-foreground">{tp(`weekdays.${d}`)}</span>
                <Input type="time" className="w-28" value={hours(d)[0]} onChange={(e) => setHours(d, 0, e.target.value)} />
                <span>–</span>
                <Input type="time" className="w-28" value={hours(d)[1]} onChange={(e) => setHours(d, 1, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
        <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={pending}>{tc("save")}</Button></div>
      </form>
    </Section>
  );
}

function Posts({ slug, posts, branches }: Parameters<typeof SettingsTabs>[0]) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ branch_id: branches[0]?.id ?? "", name: "", kind: "general", equipment: "lift, balancer, changer", is_active: true });
  return (
    <div className="max-w-3xl space-y-4">
      {branches.map((br) => (
        <Section key={br.id} title={br.name}>
          <ul className="divide-y text-sm">
            {posts.filter((p) => p.branch_id === br.id).map((p) => (
              <PostRow key={p.id} slug={slug} post={p} />
            ))}
          </ul>
        </Section>
      ))}
      <Section title={t("newPost")}>
        <form className="grid gap-3 p-4 sm:grid-cols-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { if (toastResult(await savePost(slug, null, draft))) { setDraft({ ...draft, name: "" }); router.refresh(); } });
        }}>
          <Field label={tc("branch")}><NativeSelect value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>
          <Field label={tc("name")}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></Field>
          <Field label="Type"><NativeSelect value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{["general", "express", "truck", "alignment", "repair"].map((k) => <option key={k}>{k}</option>)}</NativeSelect></Field>
          <Field label={t("equipment")}><Input value={draft.equipment} onChange={(e) => setDraft({ ...draft, equipment: e.target.value })} /></Field>
          <div className="sm:col-span-4"><Button size="sm" type="submit" disabled={pending}><Plus />{tc("add")}</Button></div>
        </form>
      </Section>
    </div>
  );
}

function PostRow({ slug, post }: { slug: string; post: Post }) {
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [p, setP] = useState(post);
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2">
      <Input className="w-40" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
      <Input className="min-w-40 flex-1" value={p.equipment} onChange={(e) => setP({ ...p, equipment: e.target.value })} />
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.is_active} onChange={(e) => setP({ ...p, is_active: e.target.checked })} />on</label>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => start(async () => { if (toastResult(await savePost(slug, p.id, p))) router.refresh(); })}>{tc("save")}</Button>
    </li>
  );
}

function Team({ slug, members, employees }: Parameters<typeof SettingsTabs>[0]) {
  const t = useTranslations("employees");
  const tc = useTranslations("common");
  const router = useRouter();
  const toastResult = useActionToast();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "mechanic" | "accountant" | "owner">("mechanic");
  const [emp, setEmp] = useState("");
  return (
    <div className="max-w-3xl space-y-4">
      <Section title={tc("name")}>
        <ul className="divide-y text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-2">
              <span>{m.name}</span><span className="text-muted-foreground">{t(`roles.${m.role}` as "roles.owner")}{m.active ? "" : " (off)"}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("invite")}>
        <form className="grid gap-3 p-4 sm:grid-cols-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { if (toastResult(await inviteMember(slug, email, role, emp || undefined), t("invited"))) { setEmail(""); router.refresh(); } });
        }}>
          <div className="sm:col-span-2"><Field label={tc("email")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field></div>
          <Field label={t("role")}>
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {(["manager", "mechanic", "accountant", "owner"] as const).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("title")}>
            <NativeSelect value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">—</option>
              {employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-4"><Button size="sm" type="submit" disabled={pending}>{t("invite")}</Button></div>
        </form>
      </Section>
    </div>
  );
}
