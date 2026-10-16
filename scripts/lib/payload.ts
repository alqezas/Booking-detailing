import type {BusinessConfig} from '../../shared/business.ts';
import {configMediaUrl} from '../../shared/media.ts';

/** business.json → svc_sync_tenant payload: image paths become site URLs. */
export function toSyncPayload(config: BusinessConfig): BusinessConfig {
  return {
    ...config,
    images: {
      hero: configMediaUrl(config.slug, config.images.hero),
      logo: configMediaUrl(config.slug, config.images.logo),
      ...(config.images.icon ? {icon: configMediaUrl(config.slug, config.images.icon)} : {}),
    },
    gallery: config.gallery.map(g => ({...g, image: configMediaUrl(config.slug, g.image)})),
  };
}
