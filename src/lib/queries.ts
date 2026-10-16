import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {getAvailability, getBooking} from './api/public.ts';

export const availabilityKey = (slug: string, serviceId: string, from: string, days: number) =>
  ['availability', slug, serviceId, from, days] as const;

export function useAvailability(slug: string, serviceId: string | null, from: string, days: number) {
  return useQuery({
    queryKey: availabilityKey(slug, serviceId ?? '', from, days),
    queryFn: () => getAvailability(slug, serviceId!, from, days),
    enabled: !!serviceId,
    staleTime: 20_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export const bookingKey = (slug: string, token: string) => ['booking', slug, token] as const;

export function usePublicBooking(slug: string, token: string | null) {
  return useQuery({
    queryKey: bookingKey(slug, token ?? ''),
    queryFn: () => getBooking(slug, token!),
    enabled: !!token,
    staleTime: 15_000,
  });
}
