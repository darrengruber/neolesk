import { useMemo } from 'react';
import { getExampleUrl } from '../examples/cache';
import type { ExampleDefinition } from '../types';

interface ExampleImageProps {
    example: ExampleDefinition;
    alt: string;
}

const ExampleImage = ({ example, alt }: ExampleImageProps): JSX.Element => {
    const primaryUrl = useMemo(() => getExampleUrl(example), [example]);

    return (
        <img
            alt={alt}
            src={primaryUrl}
        />
    );
};

export default ExampleImage;
