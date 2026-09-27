import { useId, type CSSProperties } from 'react';
import {
    consentServerForChoice,
    type Preferences,
    type RemoteRenderingChoice,
} from '../preferences/preferences';
import { Group, OptionRow, SegmentedControl, SwitchRow } from '../ui/controls';
import { hostOf } from '../ui/model';

const TRANSPARENCY_MIN = 0.55;
const TRANSPARENCY_MAX = 1;

const renderingChoices: Array<{ value: RemoteRenderingChoice; label: string }> = [
    { value: 'local-only', label: 'On This Device Only' },
    { value: 'neolesk', label: 'neolesk Services' },
    { value: 'kroki-io', label: 'kroki.io' },
];

export function SettingsView({ preferences, renderServerUrl, sessionsAvailable, onChange }: {
    preferences: Preferences;
    renderServerUrl: string;
    sessionsAvailable: boolean;
    onChange: (next: Preferences) => void;
}) {
    const groupName = useId();
    const transparencyId = useId();
    const renderingDetail: Record<RemoteRenderingChoice, string> = {
        'local-only': 'Diagram source never leaves this device',
        neolesk: `Renders at ${hostOf(renderServerUrl)} and enables live sessions`,
        'kroki-io': 'Sends languages this device can’t draw to the public kroki.io render server',
    };

    return (
        <div className="SettingsView">
            <Group header="Appearance">
                <li className="Row RowControl">
                    <SegmentedControl
                        name={`${groupName}-appearance`}
                        label="Appearance"
                        value={preferences.appearance}
                        options={[
                            { value: 'auto', label: 'Automatic' },
                            { value: 'light', label: 'Light' },
                            { value: 'dark', label: 'Dark' },
                        ]}
                        onChange={(appearance) => onChange({ ...preferences, appearance })}
                    />
                </li>
                <li className="Row RowStack">
                    <label className="RowTitle" htmlFor={transparencyId}>Window Transparency</label>
                    <input
                        id={transparencyId}
                        type="range"
                        className="Slider"
                        min={TRANSPARENCY_MIN}
                        max={TRANSPARENCY_MAX}
                        step="0.05"
                        value={preferences.transparency}
                        aria-valuetext={`${Math.round(preferences.transparency * 100)} percent opaque`}
                        style={{ '--fill-to': `${((preferences.transparency - TRANSPARENCY_MIN) / (TRANSPARENCY_MAX - TRANSPARENCY_MIN)) * 100}%` } as CSSProperties}
                        onChange={(event) => onChange({ ...preferences, transparency: Number(event.target.value) })}
                    />
                </li>
            </Group>

            <Group
                header="Rendering"
                footer="Languages this device can draw always render here. Only the others use the service you choose."
            >
                {renderingChoices.map((choice) => (
                    <OptionRow
                        key={choice.value}
                        name={`${groupName}-rendering`}
                        value={choice.value}
                        label={choice.label}
                        detail={renderingDetail[choice.value]}
                        checked={(preferences.remoteRendering || 'local-only') === choice.value}
                        onSelect={(value) => onChange({
                            ...preferences,
                            remoteRendering: value as RemoteRenderingChoice,
                            consentedRenderServer: consentServerForChoice(value as RemoteRenderingChoice, renderServerUrl),
                        })}
                    />
                ))}
            </Group>

            <Group header="Editor" footer="Keep source visible without horizontal scrolling.">
                <SwitchRow
                    label="Wrap Long Lines"
                    checked={preferences.editorWrapping}
                    onChange={(editorWrapping) => onChange({ ...preferences, editorWrapping })}
                />
            </Group>

            <Group header="About">
                <li className="Row">
                    <span className="RowBody"><span className="RowTitle">Version</span></span>
                    <span className="RowTrailing">{__APP_VERSION__} ({__GIT_HASH__})</span>
                </li>
                <li className="Row">
                    <span className="RowBody"><span className="RowTitle">Live Sessions</span></span>
                    <span className="RowTrailing">{sessionsAvailable ? 'Available' : 'Unavailable'}</span>
                </li>
            </Group>
        </div>
    );
}
