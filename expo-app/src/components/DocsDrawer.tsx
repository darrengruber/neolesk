import React, { useMemo } from 'react';
import {
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import cheatSheets from '../data/cheatSheets';
import type { ExampleRecord } from '../types';
import { colors, radius, spacing } from '../theme';

interface DocsDrawerProps {
    diagramType: string;
    examples: ExampleRecord[];
    open: boolean;
    onToggle: () => void;
    onExampleImport: (example: ExampleRecord) => void;
}

const DocsDrawer = ({ diagramType, examples, open, onToggle, onExampleImport }: DocsDrawerProps): React.JSX.Element => {
    const cheatSheet = cheatSheets[diagramType];
    const docUrl = useMemo(() => {
        const defaultExample = examples.find((e) => e.default && e.diagramType === diagramType);
        return defaultExample?.doc || examples.find((e) => e.diagramType === diagramType)?.doc;
    }, [examples, diagramType]);

    const currentExamples = useMemo(
        () => examples.filter((e) => e.diagramType === diagramType),
        [examples, diagramType],
    );

    const handleDocLink = () => {
        if (docUrl) {
            if (Platform.OS === 'web') {
                window.open(docUrl, '_blank');
            } else {
                Linking.openURL(docUrl);
            }
        }
    };

    return (
        <View style={styles.container}>
            <Pressable style={styles.handle} onPress={onToggle}>
                <Text style={styles.handleText}>Docs & Examples</Text>
                <Text style={styles.handleState}>{open ? 'Close' : 'Open'}</Text>
            </Pressable>

            {open && (
                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    {cheatSheet ? (
                        <View style={styles.section}>
                            <Text style={styles.summary}>{cheatSheet.summary}</Text>

                            {docUrl ? (
                                <Pressable onPress={handleDocLink}>
                                    <Text style={styles.docLink}>Official documentation</Text>
                                </Pressable>
                            ) : null}

                            <View style={styles.cheatSections}>
                                {cheatSheet.sections.map((section) => (
                                    <View key={section.heading} style={styles.cheatSection}>
                                        <Text style={styles.cheatHeading}>{section.heading}</Text>
                                        <View style={styles.codeBlock}>
                                            <Text style={styles.codeText}>{section.items.join('\n')}</Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : docUrl ? (
                        <View style={styles.section}>
                            <Pressable onPress={handleDocLink}>
                                <Text style={styles.docLink}>Official documentation</Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {currentExamples.length > 0 ? (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Examples</Text>
                            {currentExamples.map((example) => (
                                <Pressable
                                    key={example.id}
                                    style={styles.exampleItem}
                                    onPress={() => onExampleImport(example)}
                                >
                                    <Text style={styles.exampleTitle}>{example.title}</Text>
                                    <Text style={styles.exampleDesc}>{example.description}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                </ScrollView>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
        backgroundColor: colors.surface,
    },
    handle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        backgroundColor: colors.codeBackground,
        height: 36,
    },
    handleText: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.text,
    },
    handleState: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.accent,
    },
    body: {
        maxHeight: 320,
    },
    bodyContent: {
        padding: spacing.lg,
        paddingBottom: spacing.xxl,
    },
    section: {
        marginBottom: spacing.lg,
    },
    summary: {
        fontSize: 13,
        lineHeight: 19,
        color: colors.text,
        marginBottom: spacing.md,
    },
    docLink: {
        fontSize: 13,
        color: colors.accent,
        fontWeight: '500',
        marginBottom: spacing.md,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.text,
        marginBottom: spacing.sm,
    },
    cheatSections: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
    },
    cheatSection: {
        minWidth: 160,
        flex: 1,
    },
    cheatHeading: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.xs,
    },
    codeBlock: {
        backgroundColor: colors.codeBackground,
        borderRadius: radius.sm,
        padding: spacing.sm,
    },
    codeText: {
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 16,
        color: colors.text,
    },
    exampleItem: {
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.background,
        marginBottom: spacing.xs,
    },
    exampleTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text,
    },
    exampleDesc: {
        fontSize: 11,
        color: colors.textSecondary,
        marginTop: 1,
    },
});

export default DocsDrawer;
