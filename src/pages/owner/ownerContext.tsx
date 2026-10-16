import type {Session} from '@supabase/supabase-js';
import {createContext, useContext} from 'react';
import type {OwnerApi} from '../../lib/api/owner.ts';

export type OwnerCtx = {api: OwnerApi; session: Session; slug: string; logout: () => Promise<void>};

export const OwnerContext = createContext<OwnerCtx | null>(null);

export function useOwner(): OwnerCtx {
  const c = useContext(OwnerContext);
  if (!c) throw new Error('useOwner outside OwnerRoot');
  return c;
}

/** Every owner query key starts here, so logout can drop all of them at once. */
export const ownerKey = (slug: string, ...rest: unknown[]) => ['owner', slug, ...rest];
