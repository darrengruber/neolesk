import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { loadRuntimeAssets } from './utils/runtimeAssets';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Unable to find root element.');
}

loadRuntimeAssets()
    .catch((error) => {
        console.error(error);
    })
    .finally(() => {
        ReactDOM.render(
            <React.StrictMode>
                <App />
            </React.StrictMode>,
            rootElement,
        );
    });
