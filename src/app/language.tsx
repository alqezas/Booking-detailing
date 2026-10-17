import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import csCZ from '@astryxdesign/core/locales/cs-CZ.generated.js';
import ruRU from '@astryxdesign/core/locales/ru-RU.generated.js';
import type {ReactNode} from 'react';
import {msg} from '../i18n/index.ts';

const COMPONENT_MESSAGES = {'ru-RU': ruRU, 'cs-CZ': csCZ};

/** Built-in texts of the design system (dialogs, date pickers) in the current interface language. */
export function ComponentLanguage({children}: {children: ReactNode}) {
  return (
    <InternationalizationProvider locale={msg.intl} messages={COMPONENT_MESSAGES}>
      {children}
    </InternationalizationProvider>
  );
}
