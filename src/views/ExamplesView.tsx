import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { diagramTypes } from '../state';
import type { ExampleRecord } from '../types';
import { Group, RowButton, SearchField, iconProps } from '../ui/controls';
import { groupExamples, languageSummaries, type LanguageSummary } from '../ui/model';
import { LargeTitlePage } from '../ui/Navigation';

/** The example title repeats the language name; the description says what the example shows. */
const rowTitle = (example: ExampleRecord) => example.description || example.title;
const countText = (count: number) => `${count} ${count === 1 ? 'example' : 'examples'}`;
const REPLACE_NOTE = 'Opening an example replaces the diagram in the editor.';

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
                    <Group footer={disabled ? 'Examples open after the live session connects.' : REPLACE_NOTE}>
                        {(group?.examples || []).map((example) => (
                            <RowButton
                                key={example.id}
                                title={rowTitle(example)}
                                subtitle={example.title !== name ? example.title : undefined}
                                disabled={disabled}
                                onClick={() => onSelect(example)}
                            />
                        ))}
                    </Group>
                </div>
            </LargeTitlePage>
        );
    }

    const languageRow = (summary: LanguageSummary) => (
        <li key={summary.id}>
            <button
                type="button"
                className="Row RowButton"
                data-language-row={summary.id}
                onClick={() => push(summary.id)}
            >
                <span className="RowBody"><span className="RowTitle">{summary.name}</span></span>
                <span className="RowTrailing" aria-label={countText(summary.count)}>{summary.count}</span>
                <ChevronRight className="RowChevron" {...iconProps} />
            </button>
        </li>
    );

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
                        <Group key={group.id} header={group.name} count={group.examples.length}>
                            {group.examples.map((example) => (
                                <RowButton
                                    key={example.id}
                                    title={rowTitle(example)}
                                    disabled={disabled}
                                    onClick={() => onSelect(example)}
                                />
                            ))}
                        </Group>
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
