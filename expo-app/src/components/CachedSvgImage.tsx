import React, { useEffect, useState } from 'react';
import { Image, Platform, type ImageStyle, type StyleProp } from 'react-native';
import { cachedSvgFetch } from '../utils/svgCache';

interface CachedSvgImageProps {
    url: string;
    cacheUrl?: string;
    style?: StyleProp<ImageStyle>;
    resizeMode?: 'contain' | 'cover' | 'stretch' | 'center';
}

const CachedSvgImage = ({ url, cacheUrl, style, resizeMode = 'contain' }: CachedSvgImageProps): React.JSX.Element => {
    const [blobUri, setBlobUri] = useState<string | null>(null);

    useEffect(() => {
        if (Platform.OS !== 'web') return;

        let revoke: string | null = null;
        let cancelled = false;

        cachedSvgFetch(url, cacheUrl).then((res) => {
            if (cancelled || !res.ok) return;
            return res.blob();
        }).then((blob) => {
            if (cancelled || !blob) return;
            const uri = URL.createObjectURL(blob);
            revoke = uri;
            setBlobUri(uri);
        }).catch(() => {});

        return () => {
            cancelled = true;
            if (revoke) URL.revokeObjectURL(revoke);
        };
    }, [url, cacheUrl]);

    const source = Platform.OS === 'web' && blobUri
        ? { uri: blobUri }
        : { uri: url };

    return <Image source={source} style={style} resizeMode={resizeMode} />;
};

export default React.memo(CachedSvgImage);
