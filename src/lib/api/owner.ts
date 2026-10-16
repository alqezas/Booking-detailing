import type {SupabaseClient} from '@supabase/supabase-js';
import {toApiError} from '../errors.ts';
import type {Availability, BookingStatus, OwnerBooking, Stats} from '../types.ts';

/**
 * Owner operations. Every call runs with the owner's JWT; the server resolves
 * the tenant of each row and checks membership (private.require_member), and
 * RLS limits every read to the owner's own studio.
 */
export class OwnerApi {
  constructor(
    readonly client: SupabaseClient,
    readonly tenantId: string,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const {data, error, status} = await this.client.rpc(fn, args);
    if (error) throw toApiError(error, status);
    return data as T;
  }

  private async q<T>(p: PromiseLike<{data: T | null; error: unknown; status: number}>): Promise<T> {
    const {data, error, status} = await p;
    if (error) throw toApiError(error, status);
    return data as T;
  }

  bookings = (from: string, to: string) => this.rpc<OwnerBooking[]>('owner_bookings', {p_tenant_id: this.tenantId, p_from: from, p_to: to});
  booking = (id: string) => this.rpc<OwnerBooking>('owner_booking', {p_booking_id: id});
  stats = (period: 'day' | 'week' | 'month', anchor: string) => this.rpc<Stats>('owner_stats', {p_tenant_id: this.tenantId, p_period: period, p_anchor: anchor});
  availability = (serviceId: string, from: string, days: number) =>
    this.rpc<Availability>('owner_availability', {p_tenant_id: this.tenantId, p_service_id: serviceId, p_from: from, p_days: days});

  createBooking = (a: {serviceId: string; startAt: string; name: string; phone: string; car: string; comment: string; resourceId?: string | null; key: string}) =>
    this.rpc<OwnerBooking>('owner_create_booking', {
      p_tenant_id: this.tenantId,
      p_service_id: a.serviceId,
      p_start_at: a.startAt,
      p_customer_name: a.name,
      p_customer_phone: a.phone,
      p_car: a.car,
      p_comment: a.comment,
      p_resource_id: a.resourceId ?? null,
      p_idempotency_key: a.key,
    });
  reschedule = (id: string, startAt: string, resourceId?: string | null) =>
    this.rpc<OwnerBooking>('owner_reschedule_booking', {p_booking_id: id, p_start_at: startAt, p_resource_id: resourceId ?? null});
  cancel = (id: string, reason: string) => this.rpc<OwnerBooking>('owner_cancel_booking', {p_booking_id: id, p_reason: reason});
  setStatus = (id: string, status: BookingStatus) => this.rpc<OwnerBooking>('owner_set_booking_status', {p_booking_id: id, p_status: status});
  addPayment = (id: string, kind: 'payment' | 'refund', amount: number, method: string, note: string, key: string) =>
    this.rpc<OwnerBooking>('owner_add_payment', {p_booking_id: id, p_kind: kind, p_amount: amount, p_method: method, p_note: note, p_idempotency_key: key});

  updateTenant = (patch: Record<string, unknown>) => this.rpc<unknown>('owner_update_tenant', {p_tenant_id: this.tenantId, p_patch: patch});
  setHours = (rows: {weekday: number; opens: string; closes: string}[]) => this.rpc<void>('owner_set_working_hours', {p_tenant_id: this.tenantId, p_hours: rows});
  setServiceResources = (serviceId: string, ids: string[]) => this.rpc<void>('owner_set_service_resources', {p_service_id: serviceId, p_resource_ids: ids});
  blockResource = (resourceId: string, from: string, to: string, note: string) =>
    this.rpc<string>('owner_block_resource', {p_tenant_id: this.tenantId, p_resource_id: resourceId, p_from: from, p_to: to, p_note: note});
  removeBlock = (id: string) => this.rpc<void>('owner_remove_block', {p_occupancy_id: id});

  // Catalogue tables (RLS: members only, tenant_id enforced by policy and composite FKs)
  tenantRow = () => this.q(this.client.from('tenants').select('*').eq('id', this.tenantId).maybeSingle());
  services = () => this.q(this.client.from('services').select('*, service_resources(resource_id)').eq('tenant_id', this.tenantId).order('sort').order('name'));
  resources = () => this.q(this.client.from('resources').select('*').eq('tenant_id', this.tenantId).order('sort').order('name'));
  hours = () => this.q(this.client.from('working_hours').select('weekday, opens, closes').eq('tenant_id', this.tenantId).order('weekday').order('opens'));
  exceptions = () => this.q(this.client.from('schedule_exceptions').select('*').eq('tenant_id', this.tenantId).order('day'));
  gallery = () => this.q(this.client.from('gallery_items').select('*').eq('tenant_id', this.tenantId).order('sort').order('created_at'));
  infoCards = () => this.q(this.client.from('info_cards').select('*').eq('tenant_id', this.tenantId).order('position'));
  blocks = (from: string, to: string) =>
    this.q(
      this.client
        .from('resource_occupancies')
        .select('id, resource_id, period, note')
        .eq('tenant_id', this.tenantId)
        .eq('kind', 'block')
        .overlaps('period', `[${from},${to})`),
    );
  payments = (from: string, to: string) =>
    this.q(
      this.client
        .from('payments')
        .select('id, kind, amount, method, paid_at, note, booking_id, bookings(service_name, customer_name, car)')
        .eq('tenant_id', this.tenantId)
        .gte('paid_at', from)
        .lt('paid_at', to)
        .order('paid_at', {ascending: false}),
    );

  upsertService = (id: string | null, row: Record<string, unknown>) =>
    id
      ? this.q(this.client.from('services').update(row).eq('id', id).select('id').single())
      : this.q(this.client.from('services').insert({...row, tenant_id: this.tenantId}).select('id').single());
  upsertResource = (id: string | null, row: Record<string, unknown>) =>
    id
      ? this.q(this.client.from('resources').update(row).eq('id', id).select('id').single())
      : this.q(this.client.from('resources').insert({...row, tenant_id: this.tenantId}).select('id').single());
  addException = (day: string, note: string) =>
    this.q(this.client.from('schedule_exceptions').insert({tenant_id: this.tenantId, day, is_closed: true, note}).select('id').single());
  removeException = (id: string) => this.q(this.client.from('schedule_exceptions').delete().eq('id', id).select('id'));
  saveInfoCard = (position: number, row: {icon: string; title: string; text: string}) =>
    this.q(this.client.from('info_cards').upsert({tenant_id: this.tenantId, position, ...row}).select('position').single());
  addGalleryItem = (imagePath: string, caption: string, sort: number) =>
    this.q(this.client.from('gallery_items').insert({tenant_id: this.tenantId, image_path: imagePath, caption, sort}).select('id').single());
  updateGalleryItem = (id: string, patch: {image_path?: string; caption?: string}) =>
    this.q(this.client.from('gallery_items').update(patch).eq('id', id).select('id').single());
  removeGalleryItem = (id: string) => this.q(this.client.from('gallery_items').delete().eq('id', id).select('id'));

  /** Upload into this studio's folder; the storage policy rejects any other folder. */
  async upload(file: Blob, name: string): Promise<string> {
    const path = `${this.tenantId}/${name}`;
    const {error} = await this.client.storage.from('tenant-media').upload(path, file, {upsert: false, contentType: file.type, cacheControl: '31536000'});
    if (error) throw toApiError(error);
    return path;
  }
}
