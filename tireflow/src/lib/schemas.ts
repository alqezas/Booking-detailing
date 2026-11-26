import { z } from "zod";
import { nullish } from "./action";

const checkbox = z.preprocess((v) => v === "on" || v === true, z.boolean());

const locales = ["cs", "pl", "uk", "sk", "de", "en", "ru"] as const;

export const customerSchema = z.object({
  first_name: z.string().trim().max(100).default(""),
  last_name: z.string().trim().max(100).default(""),
  phone: z.preprocess(nullish, z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/).nullable()),
  email: z.preprocess(nullish, z.email().nullable()),
  preferred_channel: z.enum(["sms", "email", "whatsapp", "telegram", "phone", "none"]).default("sms"),
  locale: z.enum(locales).default("en"),
  discount_pct: z.preprocess(nullish, z.coerce.number().min(0).max(100).nullable()),
  notes: z.preprocess(nullish, z.string().max(4000).nullable()),
  is_vip: checkbox,
  corporate_customer_id: z.preprocess(nullish, z.uuid().nullable()),
  consent_marketing: checkbox,
}).refine((v) => v.first_name || v.last_name || v.phone, { message: "required", path: ["first_name"] });

export const vehicleSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().max(80).default(""),
  year: z.preprocess(nullish, z.coerce.number().int().min(1950).max(2100).nullable()),
  plate: z.preprocess(nullish, z.string().trim().min(2).max(16).nullable()),
  vin: z.preprocess((v) => (typeof v === "string" ? nullish(v.toUpperCase()) : v), z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/).nullable()),
  category_id: z.preprocess(nullish, z.uuid().nullable()),
  rim_diameter: z.preprocess(nullish, z.coerce.number().int().min(10).max(26).nullable()),
  tire_size: z.preprocess(nullish, z.string().max(40).nullable()),
  mileage_km: z.preprocess(nullish, z.coerce.number().int().min(0).nullable()),
  has_tpms: checkbox,
  has_runflat: checkbox,
  service_notes: z.preprocess(nullish, z.string().max(2000).nullable()),
});


export type CustomerInput = z.input<typeof customerSchema>;
export type VehicleInput = z.input<typeof vehicleSchema>;
