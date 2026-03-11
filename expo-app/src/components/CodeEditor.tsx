import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { colors, spacing } from '../theme';

// WebView import is conditional — not available on web platform
let WebView: React.ComponentType<any> | null = null;
if (Platform.OS !== 'web') {
    try {
        WebView = require('react-native-webview').default;
    } catch {
        // WebView not available, fall back to TextInput
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

    // Send init message once WebView loads
    const handleLoad = useCallback(() => {
        webViewRef.current?.postMessage(JSON.stringify({
            type: 'init',
            value,
            language: language || null,
            wrap: true,
        }));
    }, [value, language]);

    // Sync value changes from parent into the editor
    useEffect(() => {
        if (ready && value !== lastSentValue.current) {
            lastSentValue.current = value;
            webViewRef.current?.postMessage(JSON.stringify({
                type: 'setValue',
                value,
            }));
        }
    }, [value, ready]);

    // Sync language changes
    useEffect(() => {
        if (ready && language) {
            webViewRef.current?.postMessage(JSON.stringify({
                type: 'setLanguage',
                language,
            }));
        }
    }, [language, ready]);

    // Use WebView on native, TextInput on web
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

    // Fallback: plain TextInput (web platform or if WebView unavailable)
    return (
        <View style={styles.container}>
            <TextInput
                style={styles.editor}
                value={value}
                onChangeText={onChange}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                textAlignVertical="top"
                placeholder="Enter diagram code here..."
                placeholderTextColor={colors.textMuted}
            />
        </View>
    );
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
    editor: {
        flex: 1,
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 22,
        color: colors.text,
        padding: spacing.lg,
        textAlignVertical: 'top',
    },
});

export default CodeEditor;
