import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { reloadIfNewBuild } from './utils/appVersion';

// Vite reports a lazy chunk that failed to load; after a deploy that means a newer build.
window.addEventListener('vite:preloadError', () => { void reloadIfNewBuild(); });

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Unable to find root element.');
}

createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
