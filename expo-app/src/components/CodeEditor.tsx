import React, { useCallback } from 'react';
import {
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { colors, spacing } from '../theme';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
}

const CodeEditor = ({ value, onChange }: CodeEditorProps): React.JSX.Element => {
    const handleChange = useCallback((text: string) => {
        onChange(text);
    }, [onChange]);

    return (
        <View style={styles.container}>
            <TextInput
                style={styles.editor}
                value={value}
                onChangeText={handleChange}
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
