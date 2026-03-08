import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

globalThis.jest = vi;

afterEach(() => {
    cleanup();
});
