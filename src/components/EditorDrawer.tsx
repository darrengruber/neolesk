import { useMemo } from 'react';
import type { ExampleRecord } from '../types';
import cheatSheets from '../data/cheatSheets';
import { decode } from '../kroki/coder';

interface EditorDrawerProps {
    diagramType: string;
    examples: ExampleRecord[];
    editorDirty: boolean;
    open: boolean;
    onToggle: () => void;
    onExampleImport: (example: ExampleRecord) => void;
}

function EditorDrawer({ diagramType, examples, editorDirty, open, onToggle, onExampleImport }: EditorDrawerProps): JSX.Element {
    const cheatSheet = cheatSheets[diagramType];
    const docUrl = useMemo(() => {
        const defaultExample = examples.find((e) => e.default);
        return defaultExample?.doc || examples[0]?.doc;
    }, [examples]);

    const handleExampleClick = (example: ExampleRecord) => {
        if (editorDirty) {
            const confirmed = window.confirm('Replace current editor content with this example?');
            if (!confirmed) return;
        }
        onExampleImport(example);
    };

    return (
        <div className={`EditorDrawer${open ? ' open' : ''}`}>
            <button type="button" className="EditorDrawerHandle" onClick={onToggle}>
                <span className="EditorDrawerHandleText">
                    <strong>Docs & Examples</strong>
                </span>
                <span className="EditorDrawerHandleState">{open ? 'Close' : 'Open'}</span>
            </button>
            {open ? (
                <div className="EditorDrawerBody">
                    {cheatSheet ? (
                        <div className="CheatSheet">
                            <p className="CheatSheetSummary">{cheatSheet.summary}</p>
                            {docUrl ? (
                                <a className="CheatSheetDocLink" href={docUrl} target="_blank" rel="noreferrer">
                                    Official documentation
                                </a>
                            ) : null}
                            <div className="CheatSheetSections">
                                {cheatSheet.sections.map((section) => (
                                    <div key={section.heading} className="CheatSheetSection">
                                        <h4 className="CheatSheetHeading">{section.heading}</h4>
                                        <pre className="CheatSheetCode code">{section.items.join('\n')}</pre>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : docUrl ? (
                        <div className="CheatSheet">
                            <a className="CheatSheetDocLink" href={docUrl} target="_blank" rel="noreferrer">
                                Official documentation
                            </a>
                        </div>
                    ) : null}

                    {examples.length > 0 ? (
                        <div className="DrawerExamples">
                            <h4 className="DrawerExamplesHeading">Examples</h4>
                            <div className="DrawerExamplesList">
                                {examples.map((example) => (
                                    <button
                                        key={example.id}
                                        type="button"
                                        className="DrawerExampleItem"
                                        onClick={() => handleExampleClick(example)}
                                    >
                                        <span className="DrawerExampleTitle">{example.title}</span>
                                        <span className="DrawerExampleDesc">{example.description}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export default EditorDrawer;
