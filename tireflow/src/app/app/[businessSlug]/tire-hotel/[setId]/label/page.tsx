import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/app/print-button";

// 100 × 60 mm label for the tire stack. QR carries only the set code.
export default async function LabelPage({ params }: PageProps<"/app/[businessSlug]/tire-hotel/[setId]/label">) {
  const { businessSlug, setId } = await params;
  const ctx = await requirePermission(businessSlug, "tire_hotel.view", "tire_hotel");
  const supabase = await createClient();
  const { data: s } = await supabase.from("tire_sets")
    .select("code, quantity, season, width, profile, diameter, manufacturer, with_rims, vehicle:vehicles(plate), location:storage_locations(code)")
    .eq("id", setId).eq("business_id", ctx.id).maybeSingle();
  if (!s) notFound();
  const qr = await QRCode.toDataURL(`TF:${s.code}`, { margin: 0, width: 300 });
  const [t, tc] = await Promise.all([getTranslations("hotel"), getTranslations("common")]);
  return (
    <div className="p-6">
      <div className="no-print mb-4"><PrintButton label={tc("print")} /></div>
      <div className="flex h-[60mm] w-[100mm] items-center gap-4 border border-black bg-white p-3 text-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={s.code} className="h-[44mm] w-[44mm]" />
        <div className="min-w-0">
          <div className="text-3xl font-black leading-none">{s.location?.code ?? "—"}</div>
          <div className="mt-1 text-lg font-bold">{s.code}</div>
          <div className="font-mono text-base">{s.vehicle?.plate}</div>
          <div className="mt-1 text-xs">{s.quantity}× {t(`seasons.${s.season as "summer"}`)} {s.width && `${s.width}/${s.profile} R${s.diameter}`}</div>
          <div className="text-xs">{s.manufacturer} {s.with_rims ? `· ${t("withRims")}` : ""}</div>
          <div className="mt-1 text-[9px]">{ctx.name}</div>
        </div>
      </div>
    </div>
  );
}
