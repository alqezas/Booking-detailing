import {Banner} from '@astryxdesign/core/Banner';
import {msg} from '../i18n/index.ts';

/** Shown on every page of a studio that has not been activated yet. */
export function PreviewBanner() {
  return (
    <Banner
      status="info"
      container="section"
      title={msg.preview.title}
      description={msg.preview.text}
      collapsible={false}
    />
  );
}
