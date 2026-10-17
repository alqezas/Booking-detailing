import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app/App.tsx';
import {browserLang, langOf, setLang} from './i18n/index.ts';

// Until the studio loads: its built page carries <html lang>, the bare domain follows the browser.
setLang(location.pathname.startsWith('/s/') ? langOf(document.documentElement.lang) : browserLang());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
