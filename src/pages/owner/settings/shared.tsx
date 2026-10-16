import {useQueryClient} from '@tanstack/react-query';
import {useCallback} from 'react';
import {tenantQueryKey} from '../../../app/tenant.tsx';
import {ownerKey, useOwner} from '../ownerContext.tsx';

/** After any settings change: refresh the public studio card and owner data. */
export function useRefreshStudio() {
  const qc = useQueryClient();
  const {slug} = useOwner();
  return useCallback(() => {
    void qc.invalidateQueries({queryKey: tenantQueryKey(slug)});
    void qc.invalidateQueries({queryKey: ownerKey(slug)});
    void qc.invalidateQueries({queryKey: ['availability', slug]});
  }, [qc, slug]);
}

export const errorStatus = (msg?: string) => (msg ? ({type: 'error', message: msg} as const) : undefined);

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
export const MAX_UPLOAD = 25 * 1024 * 1024; // before client-side compression
