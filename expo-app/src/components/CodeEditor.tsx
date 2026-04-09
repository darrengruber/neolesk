import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

// WebView import is conditional — not available on web platform
let WebView: React.ComponentType<any> | null = null;
if (Platform.OS !== 'web') {
    try {
        WebView = require('react-native-webview').default;
    } catch {
        // WebView not available
    }
}

// CodeMirror React wrapper — only available on web
let CodeEditorWeb: React.ComponentType<any> | null = null;
if (Platform.OS === 'web') {
    try {
        CodeEditorWeb = require('./CodeEditorWeb').default;
    } catch {
        // Fallback handled below
    }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const editorHtml = Platform.OS !== 'web' ? require('../../assets/codemirror.html') : null;

interface CodeEditorProps {
    value: string;
    language?: string | null;
    onChange: (value: string) => void;
}

const CodeEditor = ({ value, language, onChange }: CodeEditorProps): React.JSX.Element => {
    const webViewRef = useRef<any>(null);
    const [ready, setReady] = useState(false);
    const lastSentValue = useRef(value);

    const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'ready') {
                setReady(true);
            }
            if (data.type === 'change') {
                lastSentValue.current = data.value;
                onChange(data.value);
            }
        } catch {
            // ignore
        }
    }, [onChange]);

    const handleLoad = useCallback(() => {
        webViewRef.current?.postMessage(JSON.stringify({
            type: 'init',
            value,
            language: language || null,
            wrap: true,
        }));
    }, [value, language]);

    useEffect(() => {
        if (ready && value !== lastSentValue.current) {
            lastSentValue.current = value;
            webViewRef.current?.postMessage(JSON.stringify({
                type: 'setValue',
                value,
            }));
        }
    }, [value, ready]);

    useEffect(() => {
        if (ready && language) {
            webViewRef.current?.postMessage(JSON.stringify({
                type: 'setLanguage',
                language,
            }));
        }
    }, [language, ready]);

    // Web: use React CodeMirror wrapper
    if (Platform.OS === 'web' && CodeEditorWeb) {
        return (
            <View style={styles.container}>
                <CodeEditorWeb value={value} language={language} onChange={onChange} />
            </View>
        );
    }

    // Native: use WebView with CodeMirror HTML
    if (WebView && editorHtml) {
        return (
            <View style={styles.container}>
                <WebView
                    ref={webViewRef}
                    source={editorHtml}
                    style={styles.webview}
                    originWhitelist={['*']}
                    javaScriptEnabled
                    onLoad={handleLoad}
                    onMessage={handleWebViewMessage}
                    scrollEnabled={false}
                    bounces={false}
                    keyboardDisplayRequiresUserAction={false}
                />
            </View>
        );
    }

    return <View style={styles.container} />;
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    webview: {
        flex: 1,
        backgroundColor: colors.surface,
    },
});

export default CodeEditor;
