import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    LayoutChangeEvent,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSvgFetch } from '../hooks/useSvgFetch';
import { colors, radius, spacing } from '../theme';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface PreviewPaneProps {
    svgUrl: string;
}

const PreviewPane = ({ svgUrl }: PreviewPaneProps): React.JSX.Element => {
    const svg = useSvgFetch(svgUrl);
    const [viewportSize, setViewportSize] = useState({ width: 300, height: 400 });

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const fitToViewport = useCallback(() => {
        if (!svg.dimensions) return;
        const padding = 32;
        const scaleX = (viewportSize.width - padding) / svg.dimensions.width;
        const scaleY = (viewportSize.height - padding) / svg.dimensions.height;
        const fitScale = Math.min(scaleX, scaleY, 1);

        scale.value = withTiming(fitScale, { duration: 200 });
        savedScale.value = fitScale;
        translateX.value = withTiming(0, { duration: 200 });
        translateY.value = withTiming(0, { duration: 200 });
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
    }, [svg.dimensions, viewportSize, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

    useEffect(() => {
        if (svg.dimensions && !svg.loading) {
            fitToViewport();
        }
    }, [svg.dimensions, svg.loading, fitToViewport]);

    const pinchGesture = Gesture.Pinch()
        .onStart(() => {
            savedScale.value = scale.value;
        })
        .onUpdate((e) => {
            scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
        })
        .onEnd(() => {
            savedScale.value = scale.value;
        });

    const panGesture = Gesture.Pan()
        .onStart(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        })
        .onUpdate((e) => {
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
        })
        .onEnd(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        });

    const composed = Gesture.Simultaneous(pinchGesture, panGesture);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    const handleLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setViewportSize({ width, height });
    };

    const handleZoomIn = () => {
        const next = Math.min(MAX_SCALE, scale.value * 1.3);
        scale.value = withTiming(next, { duration: 150 });
        savedScale.value = next;
    };

    const handleZoomOut = () => {
        const next = Math.max(MIN_SCALE, scale.value / 1.3);
        scale.value = withTiming(next, { duration: 150 });
        savedScale.value = next;
    };

    return (
        <View style={styles.container}>
            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.zoomButton} onPress={handleZoomOut}>
                    <Text style={styles.zoomButtonText}>-</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.zoomButton} onPress={handleZoomIn}>
                    <Text style={styles.zoomButtonText}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.fitButton} onPress={fitToViewport}>
                    <Text style={styles.zoomButtonText}>Fit</Text>
                </TouchableOpacity>
            </View>
            <GestureHandlerRootView style={styles.viewport}>
                <GestureDetector gesture={composed}>
                    <Animated.View
                        style={[styles.canvas, animatedStyle]}
                        onLayout={handleLayout}
                    >
                        {svg.error ? (
                            <Text style={styles.errorText}>Failed to load diagram</Text>
                        ) : svg.loading ? (
                            <ActivityIndicator size="large" color={colors.accent} />
                        ) : svg.svgUrl ? (
                            <Image
                                source={{ uri: svg.svgUrl }}
                                style={
                                    svg.dimensions
                                        ? { width: svg.dimensions.width, height: svg.dimensions.height }
                                        : { width: 400, height: 300 }
                                }
                                resizeMode="contain"
                            />
                        ) : null}
                    </Animated.View>
                </GestureDetector>
            </GestureHandlerRootView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        backgroundColor: colors.surface,
    },
    zoomButton: {
        width: 36,
        height: 32,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fitButton: {
        height: 32,
        paddingHorizontal: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        alignItems: 'center',
        justifyContent: 'center',
    },
    zoomButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    viewport: {
        flex: 1,
        overflow: 'hidden',
    },
    canvas: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorText: {
        color: colors.error,
        fontSize: 14,
    },
});

export default PreviewPane;
