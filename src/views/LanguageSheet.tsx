import { useId, useMemo, useState } from 'react';
import { getBrowserRenderCapabilities } from '../hooks/useDiagramRender';
import { diagramTypes } from '../state';
import { Group, OptionRow, SearchField } from '../ui/controls';
import { filterLanguages } from '../ui/model';
import { Sheet } from '../ui/Sheet';

const isLocal = (id: string) => getBrowserRenderCapabilities(id).local;

export function LanguageSheet({ open, language, disabled, onSelect, onClose }: {
    open: boolean;
    language: string;
    disabled: boolean;
    onSelect: (language: string) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    const groupName = useId();
    const sections = useMemo(() => filterLanguages(diagramTypes, query, isLocal), [query]);
    const close = () => {
        setQuery('');
        onClose();
    };

    return (
        <Sheet open={open} title="Diagram Language" onClose={close} className="LanguageSheet">
            <SearchField value={query} onChange={setQuery} label="Search languages" placeholder="Search" />
            {disabled && <p className="GroupFooter">You can change the language after the live session connects.</p>}
            {sections.length === 0 && <p className="EmptyDetail SheetEmpty">No languages match “{query.trim()}”.</p>}
            <div role="radiogroup" aria-label="Diagram language">
                {sections.map((section) => (
                    <Group
                        key={section.id}
                        header={section.title}
                        footer={section.id === 'remote'
                            ? 'These languages render only with the render server chosen in Settings.'
                            : undefined}
                    >
                        {section.languages.map((option) => (
                            <OptionRow
                                key={option.id}
                                name={groupName}
                                value={option.id}
                                label={option.name}
                                checked={option.id === language}
                                disabled={disabled}
                                onSelect={(value) => {
                                    onSelect(value);
                                    close();
                                }}
                            />
                        ))}
                    </Group>
                ))}
            </div>
        </Sheet>
    );
}
