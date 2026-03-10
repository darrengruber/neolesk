import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Unable to find root element.');
}

ReactDOM.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
    rootElement,
);
