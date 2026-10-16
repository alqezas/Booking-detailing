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
};

export type InfoCard = {position: number; icon: string; title: string; text: string};
export type GalleryItem = {id: string; image_path: string; caption: string; updated_at: string};
export type HoursRow = {weekday: number; opens: string; closes: string};
export type ScheduleException = {day: string; is_closed: boolean; opens: string | null; closes: string | null; note: string | null};

export type PublicTenant = {
  id: string;
  slug: string;
  status: TenantStatus;
  kind: 'detailing' | 'autoservice';
  name: string;
  short_name: string | null;
  tagline: string;
  description: string;
  timezone: string;
  currency: string;
  locale: string;
  accent_color: string;
  phone: string;
  address: string;
  map_url: string | null;
  lat: number | null;
  lng: number | null;
  telegram: string | null;
  whatsapp: string | null;
  email: string | null;
  logo_path: string | null;
  hero_path: string | null;
  assistant_enabled: boolean;
  booking: {slot_step_minutes: number; min_lead_minutes: number; horizon_days: number; cancel_cutoff_hours: number};
  services: Service[];
  hours: HoursRow[];
  exceptions: ScheduleException[];
  info_cards: InfoCard[];
  gallery: GalleryItem[];
};

export type Slot = {start_at: string; available: boolean};
export type AvailabilityDay = {date: string; slots: Slot[]};
export type Availability = {
  timezone: string;
  service: Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price' | 'price_from'>;
  from: string;
  to: string;
  horizon_end: string;
  days: AvailabilityDay[];
};

export type ReminderState = {status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'skipped'; run_at: string; note: string | null};

export type PublicBooking = {
  id: string;
  status: BookingStatus;
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
  resource_name: string;
  is_demo: boolean;
  cancel_deadline: string;
  can_cancel: boolean;
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
  cancelled: number;
  no_show: number;
  arrivals: number;
  completed: number;
  received: number;
  refunded: number;
  net_received: number;
  expected_value: number;
};
