import { FileText, Link2, Monitor, Users } from 'lucide-react';
import type { RemoteRenderingChoice } from '../preferences/preferences';
import { hostOf } from '../ui/model';
import { Spinner, iconProps } from '../ui/controls';

export function LoadingScreen() {
    return (
        <main className="ConsentScreen" aria-label="Loading neolesk">
            <Spinner label="Loading…" />
        </main>
    );
}

export function ConsentScreen({ renderServerUrl, onChoose }: {
    renderServerUrl: string;
    onChoose: (choice: RemoteRenderingChoice) => void;
}) {
    return (
        <main className="ConsentScreen">
            <section className="ConsentCard" aria-labelledby="consent-title">
                <div className="ConsentSymbol"><FileText {...iconProps} /></div>
                <p className="ConsentKicker">Welcome to neolesk</p>
                <h1 id="consent-title">Keep diagrams where you expect</h1>
                <p className="ConsentIntro">
                    Most diagrams can render in this browser. Some languages and file exports need a server,
                    so neolesk asks before sending diagram source anywhere.
                </p>
                <div className="ConsentChoices">
                    <button type="button" className="ChoiceButton ChoiceButtonPrimary" aria-label="Render locally only" onClick={() => onChoose('local-only')}>
                        <Monitor {...iconProps} />
                        <span><strong>Render locally only</strong><small>Never send diagram source to a rendering service</small></span>
                    </button>
                    <button type="button" className="ChoiceButton" onClick={() => onChoose('neolesk')}>
                        <Users {...iconProps} />
                        <span><strong>Use neolesk services</strong><small>Allow fallback rendering at {hostOf(renderServerUrl)} and collaboration</small></span>
                    </button>
                    <button type="button" className="ChoiceButton" onClick={() => onChoose('kroki-io')}>
                        <Link2 {...iconProps} />
                        <span><strong>Use kroki.io</strong><small>Send unsupported diagrams to the public Kroki service</small></span>
                    </button>
                </div>
                <p className="ConsentFootnote">You can change this choice in Settings at any time.</p>
            </section>
        </main>
    );
}
