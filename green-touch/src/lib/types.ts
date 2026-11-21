export type ItemKind = 'product' | 'kit' | 'sample';

export type ItemCard = {
  id: string;
  kind: ItemKind;
  slug: string;
  name: string;
  volume: string | null;
  category: string;
  short_purpose: string | null;
  price_kop: number;
  base_kop: number | null;
  discount_bp: number;
  available: boolean;
  image: string | null;
};

export type FacetGroup = 'skin_type' | 'skin_need' | 'kit_purpose' | 'age_product' | 'age_kit' | 'season';
export type Facet = {group: FacetGroup; slug: string; label: string; count?: number};

export type ItemDetail = ItemCard & {
  category_name: string;
  description: string | null;
  inci: string | null;
  usage: string | null;
  warnings: string | null;
  published_at: string | null;
  images: {path: string; alt: string | null}[];
  facets: Facet[];
  components:
    | {id: string; slug: string; name: string; volume: string | null; qty: number; price_kop: number; available: boolean; is_public: boolean; image: string | null}[]
    | null;
  in_kits: {slug: string; name: string; price_kop: number}[];
  related: ItemCard[];
};

export type ShopSettings = {
  brand?: {
    name?: string;
    tagline?: string;
    hero_text?: string;
    about_title?: string;
    about_text?: string | null;
    cosmetologist_name?: string | null;
    cosmetologist_photo?: string | null;
    hero_photo?: string | null;
  };
  contacts?: {phone?: string | null; email?: string | null; instagram?: string | null; telegram?: string | null; address?: string | null; hours?: string | null};
  filters?: {season_visible?: boolean; age_visible?: boolean};
  delivery?: {summary?: string; payment?: string};
  legal?: {seller_name?: string | null; seller_code?: string | null; seller_address?: string | null};
  payment?: {prepay_kop?: number; prepay_enabled?: boolean; full_enabled?: boolean};
};

export type CatalogMeta = {
  categories: {slug: string; name: string; kind: ItemKind; count: number}[];
  facets: Facet[];
  price: {min_kop: number | null; max_kop: number | null};
  total: number;
  settings: ShopSettings;
  home_picks: ItemCard[];
  kits: ItemCard[];
  pages: {slug: string; title: string}[];
};

export type SearchResult = {total: number; page: number; page_size: number; items: ItemCard[]};

export type QuoteLine = {
  id: string;
  kind: ItemKind;
  slug: string | null;
  name: string | null;
  volume: string | null;
  qty: number;
  unit_base_kop: number | null;
  unit_discount_kop: number | null;
  unit_price_kop: number | null;
  line_total_kop: number | null;
  available: boolean;
  purchasable: boolean;
  image: string | null;
  components: {name: string; volume: string | null; qty: number}[] | null;
};
export type Quote = {
  lines: QuoteLine[];
  subtotal_kop: number;
  discount_kop: number;
  total_kop: number;
  ok: boolean;
};

export type GuestOrder = {
  id: string;
  number: number;
  created_at: string;
  payment_status: string;
  fulfillment_status: string;
  needs_review: boolean;
  ttn: string | null;
  subtotal_kop: number;
  discount_kop: number;
  total_kop: number;
  delivery: {method: string; settlement: string; area: string | null; warehouse: string};
  first_name: string;
  can_pay: boolean;
  payment_method: 'full_online' | 'prepay_manual';
  prepay_kop: number;
  prepay_received: boolean;
  cod_kop: number;
  lines: {
    kind: ItemKind;
    slug: string;
    name: string;
    volume: string | null;
    qty: number;
    unit_base_kop: number;
    unit_price_kop: number;
    line_total_kop: number;
    components: {name: string; volume: string | null; qty: number}[];
  }[];
};

export type PaymentStart = {state: 'redirect'; page_url: string} | {state: 'paid' | 'processing' | 'in_progress' | 'unavailable' | 'manual'};
