import baseData from './data';
import diagramMetadata from '../kroki/metadata';
import type { ExampleDefinition } from '../types';

const extraExamples: ExampleDefinition[] = [
    {
        diagramType: 'symbolator',
        default: true,
        description: 'Default',
        title: 'Symbolator',
        example: 'eNp1UMEOgjAMve8rmnCRBFFuRuPB4A4knIR40BgyWWMWx0bG0IP47wJ6IKg9tOnre69pC81ricCx0BnHm8gRnAmBNmYzBx6P57NvSmZYgRYNJNGBwhoW3gjf0YSm2SZMoz3NYrqnccsKiAtDt1zq_Fo1YVeEunzMhSprC3dhEHqCN1RoZY2WTfiuUImLYrL6Vhqs0HpjFBU7SxwacmZZs20TlNrYH0bH7sJpsJyfoONmQr3lurZ_Oe2MuCvS7QDf9wkqXvSPfQFdM2uY',
        doc: 'https://zebreus.github.io/symbolator/',
        keywords: ['hardware', 'diagram', 'rtl', 'verilog', 'vhdl', 'ports'],
    },
];

const mergedData: ExampleDefinition[] = [...baseData, ...extraExamples].map((item) => {
    const metadata = diagramMetadata[item.diagramType] || {};
    if (item.language || !metadata.language) {
        return item;
    }
    return { ...item, language: metadata.language };
});

export default mergedData;
