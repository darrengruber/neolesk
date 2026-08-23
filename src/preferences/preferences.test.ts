import { beforeEach, describe, expect, it } from 'vitest';
import {
    PREFERENCES_KEY,
    getConsentedRemoteRenderer,
    loadPreferences,
    savePreferences,
} from './preferences';

describe('preferences', () => {
    let storage: Storage;

    beforeEach(() => {
        const values = new Map<string, string>();
        storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (key) => values.get(key) ?? null,
            key: (index) => Array.from(values.keys())[index] ?? null,
            removeItem: (key) => { values.delete(key); },
            setItem: (key, value) => { values.set(key, value); },
        };
    });

    it('starts without remote-render consent and follows system appearance', () => {
        expect(loadPreferences(storage)).toEqual({
            appearance: 'auto',
            editorWrapping: true,
            remoteRendering: null,
            consentedRenderServer: null,
            transparency: 0.72,
        });
    });

    it('stores only versioned user choices', () => {
        savePreferences(storage, {
            appearance: 'dark',
            editorWrapping: false,
            remoteRendering: 'local-only',
            consentedRenderServer: null,
            transparency: 0.5,
        });

        expect(PREFERENCES_KEY).toBe('neolesk:preferences:v3');
        expect(JSON.parse(storage.getItem(PREFERENCES_KEY) || '{}')).toEqual({
            appearance: 'dark',
            editorWrapping: false,
            remoteRendering: 'local-only',
            consentedRenderServer: null,
            transparency: 0.5,
        });
    });

    it('never turns malformed storage into consent', () => {
        storage.setItem(PREFERENCES_KEY, '{broken');
        expect(loadPreferences(storage).remoteRendering).toBeNull();

        storage.setItem(PREFERENCES_KEY, JSON.stringify({ remoteRendering: 'yes-please' }));
        expect(loadPreferences(storage).remoteRendering).toBeNull();
    });

    it('maps the first-run choice to the exact consented server', () => {
        expect(getConsentedRemoteRenderer('local-only', null, 'https://diagrams.darrengruber.com/render/')).toBeNull();
        expect(getConsentedRemoteRenderer('neolesk', 'https://diagrams.darrengruber.com/render/', 'https://diagrams.darrengruber.com/render/')).toMatchObject({
            id: 'neolesk',
            label: "neolesk's renderer",
            url: 'https://diagrams.darrengruber.com/render/',
        });
        expect(getConsentedRemoteRenderer('kroki-io', 'https://kroki.io/', 'https://diagrams.darrengruber.com/render/')).toMatchObject({
            id: 'kroki-io',
            label: 'kroki.io',
            url: 'https://kroki.io/',
        });
        expect(getConsentedRemoteRenderer(
            'neolesk',
            'https://diagrams.darrengruber.com/render/',
            'https://diagrams.darrengruber.com/render/',
        )?.capabilities.d2.optionDefinitions.layout).toEqual({ type: 'enum', values: ['dagre'] });
        expect(getConsentedRemoteRenderer('neolesk', 'https://old.example/render/', 'https://diagrams.darrengruber.com/render/')).toBeNull();
        expect(getConsentedRemoteRenderer(null, null, 'https://diagrams.darrengruber.com/render/')).toBeNull();
    });
});
