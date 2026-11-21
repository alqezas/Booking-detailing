import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import ukUA from '@astryxdesign/core/locales/uk-UA.generated.js';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app/App.tsx';
import {registerServiceWorker} from './lib/pwa.ts';

// Ukrainian for Astryx's own strings and date formats (calendar, clear/close buttons).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InternationalizationProvider locale="uk-UA" messages={{'uk-UA': ukUA}}>
      <App />
    </InternationalizationProvider>
  </StrictMode>,
);
registerServiceWorker();
