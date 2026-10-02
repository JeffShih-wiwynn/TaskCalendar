import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { PrivacyPolicy } from './PrivacyPolicy';
import './styles.css';

const isPrivacyPolicyRoute =
  window.location.pathname.replace(/\/+$/, '') === '/privacy';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPrivacyPolicyRoute ? <PrivacyPolicy /> : <App />}
  </StrictMode>,
);
