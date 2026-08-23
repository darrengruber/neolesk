import type { RemoteRenderer } from '../rendering/rendering';

export type Appearance = 'auto' | 'light' | 'dark';
export type RemoteRenderingChoice = 'local-only' | 'neolesk' | 'kroki-io';

export interface Preferences {
    appearance: Appearance;
    editorWrapping: boolean;
    remoteRendering: RemoteRenderingChoice | null;
    transparency: number;
}

export const PREFERENCES_KEY = 'neolesk:preferences:v3';

export const defaultPreferences: Preferences = {
    appearance: 'auto',
    editorWrapping: true,
    remoteRendering: null,
    transparency: 0.72,
};

const appearances = new Set<Appearance>(['auto', 'light', 'dark']);
const remoteChoices = new Set<RemoteRenderingChoice>(['local-only', 'neolesk', 'kroki-io']);

export const loadPreferences = (storage: Pick<Storage, 'getItem'>): Preferences => {
    try {
        const serialized = storage.getItem(PREFERENCES_KEY);
        if (!serialized) return { ...defaultPreferences };

        const value = JSON.parse(serialized) as Record<string, unknown>;
        return {
            appearance: typeof value.appearance === 'string' && appearances.has(value.appearance as Appearance)
                ? value.appearance as Appearance
                : defaultPreferences.appearance,
            editorWrapping: typeof value.editorWrapping === 'boolean'
                ? value.editorWrapping
                : defaultPreferences.editorWrapping,
            remoteRendering: typeof value.remoteRendering === 'string'
                && remoteChoices.has(value.remoteRendering as RemoteRenderingChoice)
                ? value.remoteRendering as RemoteRenderingChoice
                : null,
            transparency: typeof value.transparency === 'number'
                && Number.isFinite(value.transparency)
                ? Math.min(1, Math.max(0, value.transparency))
                : defaultPreferences.transparency,
        };
    } catch {
        return { ...defaultPreferences };
    }
};

export const savePreferences = (
    storage: Pick<Storage, 'setItem'>,
    preferences: Preferences,
): void => {
    try {
        storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
        // The editor remains usable when storage is disabled or full.
    }
};

export const getConsentedRemoteRenderer = (
    choice: RemoteRenderingChoice | null,
    neoleskRenderUrl: string,
): RemoteRenderer | null => {
    if (choice === 'neolesk') {
        return {
            id: 'neolesk',
            label: "neolesk's renderer",
            url: neoleskRenderUrl,
        };
    }
    if (choice === 'kroki-io') {
        return {
            id: 'kroki-io',
            label: 'kroki.io',
            url: 'https://kroki.io/',
        };
    }
    return null;
};
