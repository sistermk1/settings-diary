import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import SettingsDiary from './SettingsDiary.jsx';
import './index.css';

// auto-update service worker: new deploys take effect on next launch
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SettingsDiary />
  </React.StrictMode>,
);
