import type {SeasonPeriod, TireConfig, TireSeason, TireSource} from '../../supabase/functions/_shared/tire.ts';
import type {PeakRule, WashConfig} from '../../supabase/functions/_shared/wash.ts';

export type TenantStatus = 'preview' | 'live' | 'suspended';
export type BookingStatus = 'confirmed' | 'arrived' | 'ready' | 'cancelled' | 'no_show';

export type Service = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  price: number;
  price_from: boolean;
  duration_minutes: number;
  /** Resources (masters/bays) that can do the service (absent before the beauty migration). */
  resource_ids?: string[];
  /** Options of the service (beauty): price and minutes are added on the server. */
  addons?: Addon[];
};

export type Addon = {key: string; name: string; price: number; duration_minutes: number};

/** A master or a place (beauty), a bay or post (car studios). */
export type Resource = {id: string; key: string; name: string; role: 'master' | 'place'; title: string; bio: string; photo_path: string | null};

/** Snapshot of the chosen options in a beauty booking. */
export type AddonsParams = {
  kind: 'addons';
  addons: Addon[];
  base_price: number;
  base_minutes: number;
  master_choice: 'any' | 'specific';
};
export type TireParamsSnapshot = {vehicle: string; rim: string; diameter: number; wheels: number; on_request: boolean};

export type InfoCard = {position: number; icon: string; title: string; text: string};
export type FaqItem = {question: string; answer: string};
export type GalleryItem = {id: string; image_path: string; before_path: string | null; caption: string; updated_at: string};
export type HoursRow = {weekday: number; opens: string; closes: string};
export type ScheduleException = {day: string; is_closed: boolean; opens: string | null; closes: string | null; note: string | null};

export type PublicTenant = {
  id: string;
  slug: string;
  status: TenantStatus;
  kind: 'detailing' | 'autoservice' | 'tireservice' | 'carwash' | 'beauty';
  name: string;
  short_name: string | null;
  tagline: string;
  description: string;
  timezone: string;
  currency: string;
  locale: string;
  accent_color: string;
  /** Beauty studios are light unless the config asks for 'dark' (barbershops). */
  appearance?: 'light' | 'dark' | 'cream' | null;
  /** Words of the interface on top of the kind: 'barber' for barbershops (beauty kind). */
  vocabulary?: 'barber' | null;
  phone: string;
  address: string;
  /** Registered office when it differs from the workshop address. */
  legal_address: string | null;
  map_url: string | null;
  lat: number | null;
  lng: number | null;
  telegram: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  email: string | null;
  logo_path: string | null;
  hero_path: string | null;
  assistant_enabled: boolean;
  booking: {
    slot_step_minutes: number;
    min_lead_minutes: number;
    horizon_days: number;
    /** Today's horizon: shorter while a tyre season with its own horizon runs (absent before the tyre migration). */
    effective_horizon_days?: number;
    cancel_cutoff_hours: number;
    default_buffer_minutes: number;
  };
  /** Tyre services: the price matrix (null for other studios) and the seasons. */
  tire?: TireConfig | null;
  tire_seasons?: SeasonPeriod[];
  /** Car wash: programs by car class and extras (null for other studios). */
  wash?: WashConfig | null;
  /** Online booking closed or limited in these windows (any studio). */
  peak_hours?: PeakRule[];
  services: Service[];
  /** Masters and places (absent before the beauty migration). */
  resources?: Resource[];
  hours: HoursRow[];
  exceptions: ScheduleException[];
  info_cards: InfoCard[];
  gallery: GalleryItem[];
  faq: FaqItem[];
};

export type Slot = {start_at: string; available: boolean};
export type AvailabilityDay = {date: string; slots: Slot[]};
export type ServerQuote = {
  kind?: 'tire' | 'wash' | 'addons';
  price: number;
  on_request: boolean;
  duration_minutes: number;
  wheels?: number;
  label: string;
  price_from?: boolean;
  base_price?: number;
  base_minutes?: number;
  addons?: Addon[];
};

export type Availability = {
  quote?: ServerQuote;
  timezone: string;
  service: Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price' | 'price_from'>;
  from: string;
  to: string;
  horizon_end: string;
  resource_id?: string | null;
  days: AvailabilityDay[];
};

export type ReminderState = {status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'skipped'; run_at: string; note: string | null};

export type PublicBooking = {
  id: string;
  status: BookingStatus;
  service_id?: string;
  service_name: string;
  price: number;
  price_from: boolean;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  customer_name: string;
  customer_phone: string;
  car: string;
  comment: string;
  plate?: string | null;
  tire_size?: string | null;
  tire_source?: TireSource | null;
  tire_params?: TireParamsSnapshot | AddonsParams | null;
  resource_name: string;
  resource_role?: 'master' | 'place';
  is_demo: boolean;
  cancel_deadline: string;
  can_cancel: boolean;
  can_reschedule?: boolean;
  cancel_cutoff_hours: number;
  reminder: ReminderState | null;
  tenant: {slug: string; name: string; phone: string; address: string; map_url: string | null; timezone: string; currency: string; status: TenantStatus};
};

export type Payment = {id: string; kind: 'payment' | 'refund'; amount: number; method: 'cash' | 'card' | 'transfer' | 'other'; paid_at: string; note: string};

export type OwnerBooking = {
  id: string;
  tenant_id: string;
  status: BookingStatus;
  service_id: string;
  service_name: string;
  resource_id: string;
  resource_name: string;
  start_at: string;
  end_at: string;
  occupancy_end_at: string;
  price: number;
  price_from: boolean;
  duration_minutes: number;
  customer_name: string;
  customer_phone: string;
  car: string;
  comment: string;
  plate?: string | null;
  tire_size?: string | null;
  tire_source?: TireSource | null;
  tire_params?: TireParamsSnapshot | AddonsParams | null;
  /** Wash pass that paid for this booking (marked ready). */
  pass?: {pass_id: string; total: number; remaining: number} | null;
  source: 'client' | 'owner' | 'demo';
  is_demo: boolean;
  arrived_at: string | null;
  ready_at: string | null;
  cancelled_at: string | null;
  cancelled_by: 'client' | 'owner' | null;
  cancel_reason: string | null;
  created_at: string;
  paid: number;
  refunded: number;
  balance: number;
  payments: Payment[];
};

export type Stats = {
  period: 'day' | 'week' | 'month';
  timezone: string;
  from_date: string;
  to_date: string;
  from_at: string;
  to_at: string;
  bookings: number;
  /** Confirmed bookings still ahead (from now) in the period, and their agreed value — a forecast. */
  upcoming?: number;
  upcoming_value?: number;
  cancelled: number;
  no_show: number;
  arrivals: number;
  completed: number;
  received: number;
  refunded: number;
  net_received: number;
  expected_value: number;
};

export type TireSet = {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_phone: string;
  plate: string;
  car: string;
  tire_size: string;
  season: TireSeason;
  with_rims: boolean;
  tread_mm: number | null;
  condition: string;
  location: string;
  stored_at: string;
  released_at: string | null;
  last_contacted_at: string | null;
  note: string;
  next_booking_at?: string | null;
  due?: boolean;
};

export type TireSetsView = {today: string; season: (SeasonPeriod & {start: string}) | null; sets: TireSet[]};

export type WashPass = {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_phone: string;
  plate: string;
  service_id: string | null;
  service_name?: string | null;
  total: number;
  price: number | null;
  sold_at: string;
  expires_at: string | null;
  note: string;
  used?: number;
  remaining?: number;
  last_used_at?: string | null;
};

export const isAddonsParams = (p: PublicBooking['tire_params']): p is AddonsParams => !!p && (p as AddonsParams).kind === 'addons';
