'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api-client';
import {
  INDIA_PROFILE,
  resolveRegionalProfile,
  type RegionalProfile,
} from '../lib/market-profile';

type TenantRegionalSettings = {
  market_profile?: string | null;
  default_currency?: string | null;
  tax_regime?: string | null;
  locale?: string | null;
  timezone?: string | null;
};

/**
 * Resolves commercial terminology and defaults from the signed-in tenant.
 * The fallback is deliberately the existing India profile so a failed settings
 * request never exposes UAE terminology to an Indian tenant (or vice versa).
 */
export function useRegionalProfile(): {
  profile: RegionalProfile;
  loading: boolean;
} {
  const [profile, setProfile] = useState<RegionalProfile>(INDIA_PROFILE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiClient
      .get<TenantRegionalSettings>('/tenant/current')
      .then((tenant) => {
        if (active) setProfile(resolveRegionalProfile(tenant?.market_profile));
      })
      .catch(() => {
        if (active) setProfile(INDIA_PROFILE);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { profile, loading };
}
