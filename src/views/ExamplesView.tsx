import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { diagramTypes } from '../state';
import type { ExampleRecord } from '../types';
import { Group, SearchField, iconProps } from '../ui/controls';
import { groupExamples, languageSummaries, type LanguageSummary } from '../ui/model';
import { ExampleThumbnail } from '../ui/ExampleThumbnail';
import { LargeTitlePage } from '../ui/Navigation';

/** The example title repeats the language name; the description says what the example shows. */
const rowTitle = (example: ExampleRecord) => example.description || example.title;
const countText = (count: number) => `${count} ${count === 1 ? 'example' : 'examples'}`;
const REPLACE_NOTE = 'Opening an example replaces the diagram in the editor.';

/** A gallery of example pictures: people choose a diagram by how it looks. */
function ExampleGallery({ examples, languageName, disabled, onSelect }: {
    examples: ExampleRecord[];
    languageName: string;
    disabled: boolean;
    onSelect: (example: ExampleRecord) => void;
}) {
    return (
        <ul className="ExampleGallery">
            {examples.map((example) => (
                <li key={example.id}>
                    <button
                        type="button"
                        className="ExampleTile"
                        disabled={disabled}
                        onClick={() => onSelect(example)}
                    >
                        <ExampleThumbnail example={example} />
                        <span className="ExampleTileTitle">{rowTitle(example)}</span>
                        {example.title !== languageName && <span className="ExampleTileSubtitle">{example.title}</span>}
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Examples as an iOS navigation stack: languages, then the examples of one
 * language. A search from the root looks through every example at once.
 */
export function ExamplesView({ examples, onSelect, disabled = false, currentLanguage }: {
    examples: ExampleRecord[];
    onSelect: (example: ExampleRecord) => void;
    disabled?: boolean;
    currentLanguage: string;
}) {
    const [query, setQuery] = useState('');
    const [openLanguage, setOpenLanguage] = useState<string | null>(null);
    const [animate, setAnimate] = useState<'push' | 'pop' | undefined>(undefined);
    const returnFocusTo = useRef<string | null>(null);
    const groups = useMemo(() => groupExamples(examples, query, diagramTypes), [examples, query]);
    const allGroups = useMemo(() => groupExamples(examples, '', diagramTypes), [examples]);
    const summaries = useMemo(
        () => languageSummaries(examples, diagramTypes, currentLanguage),
        [examples, currentLanguage],
    );
    const total = groups.reduce((count, group) => count + group.examples.length, 0);

    useEffect(() => {
        // Popping back returns focus to the row the person came from.
        if (openLanguage !== null || !returnFocusTo.current) return;
        document.querySelector<HTMLElement>(`[data-language-row="${returnFocusTo.current}"]`)?.focus();
        returnFocusTo.current = null;
    }, [openLanguage]);

    const push = (language: string) => {
        returnFocusTo.current = language;
        setAnimate('push');
        setOpenLanguage(language);
    };
    const pop = () => {
        setAnimate('pop');
        setOpenLanguage(null);
    };

    if (openLanguage) {
        const group = allGroups.find((item) => item.id === openLanguage);
        const name = group?.name || openLanguage;
        return (
            <LargeTitlePage
                key={openLanguage}
                title={name}
                titleId="examples-language-title"
                animate={animate}
                focusTitle
                leading={(
                    <button type="button" className="BackButton" onClick={pop}>
                        <ChevronLeft {...iconProps} /><span>Examples</span>
                    </button>
                )}
            >
                <div className="ExamplesView">
                    <ExampleGallery
                        examples={group?.examples || []}
                        languageName={name}
                        disabled={disabled}
                        onSelect={onSelect}
                    />
                    <p className="GroupFooter">{disabled ? 'Examples open after the live session connects.' : REPLACE_NOTE}</p>
                </div>
            </LargeTitlePage>
        );
    }

    const coverOf = (language: string) => {
        const languageExamples = allGroups.find((item) => item.id === language)?.examples || [];
        return languageExamples.find((example) => example.default) || languageExamples[0];
    };

    const languageRow = (summary: LanguageSummary) => {
        const cover = coverOf(summary.id);
        return (
        <li key={summary.id}>
            <button
                type="button"
                className="Row RowButton LanguageRow"
                data-language-row={summary.id}
                onClick={() => push(summary.id)}
            >
                {cover && <ExampleThumbnail example={cover} size="row" />}
                <span className="RowBody"><span className="RowTitle">{summary.name}</span></span>
                <span className="RowTrailing" aria-label={countText(summary.count)}>{summary.count}</span>
                <ChevronRight className="RowChevron" {...iconProps} />
            </button>
        </li>
        );
    };

    return (
        <LargeTitlePage title="Examples" titleId="examples-title" animate={animate === 'pop' ? 'pop' : undefined}>
            <div className="ExamplesView">
                <SearchField value={query} onChange={setQuery} label="Search examples" placeholder="Search" />
                <p className="VisuallyHidden" role="status">{query ? `${countText(total)} found` : ''}</p>
                {query.trim() ? (
                    groups.length === 0 ? (
                        <div className="EmptyState">
                            <Search {...iconProps} />
                            <p className="EmptyTitle">No Results for “{query.trim()}”</p>
                            <p className="EmptyDetail">Check the spelling or try a new search.</p>
                        </div>
                    ) : groups.map((group) => (
                        <section key={group.id} className="Group" aria-label={group.name}>
                            <h3 className="GroupHeader">
                                {group.name}<span className="GroupCount"> {group.examples.length}</span>
                            </h3>
                            <ExampleGallery
                                examples={group.examples}
                                languageName={group.name}
                                disabled={disabled}
                                onSelect={onSelect}
                            />
                        </section>
                    ))
                ) : (
                    <>
                        {summaries.current && (
                            <Group header="Current Language">{languageRow(summaries.current)}</Group>
                        )}
                        <Group header="All Languages" footer={REPLACE_NOTE}>
                            {summaries.others.map(languageRow)}
                        </Group>
                    </>
                )}
            </div>
        </LargeTitlePage>
    );
}
