import React, { useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import type { Extension } from '@codemirror/state';

interface CodeEditorWebProps {
    value: string;
    language?: string | null;
    onChange: (value: string) => void;
}

const languageExtensions: Record<string, () => Extension> = {
    json,
    xml,
    yaml,
    markdown,
    sql,
};

const CodeEditorWeb = ({ value, language, onChange }: CodeEditorWebProps): React.JSX.Element => {
    const handleChange = useCallback((val: string) => {
        onChange(val);
    }, [onChange]);

    const extensions = useMemo(() => {
        const exts: Extension[] = [];
        if (language && languageExtensions[language]) {
            exts.push(languageExtensions[language]());
        }
        return exts;
    }, [language]);

    return (
        <CodeMirror
            value={value}
            onChange={handleChange}
            extensions={extensions}
            height="100%"
            style={{ flex: 1, overflow: 'auto' }}
            basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: false,
                highlightActiveLine: true,
                indentOnInput: true,
            }}
            theme="light"
        />
    );
};

export default CodeEditorWeb;
