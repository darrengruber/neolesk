import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { ExampleRecord } from '../types';
import { iconProps } from './controls';
import { thumbnailUrl } from './model';

const available = new Set(__EXAMPLE_THUMBNAILS__);
const isAvailable = (filename: string) => available.has(filename);

/**
 * A pre-rendered picture of an example, so a person can choose by what the
 * diagram looks like rather than by its name. It is decorative: the control
 * around it carries the example's name.
 */
export function ExampleThumbnail({ example, size = 'tile' }: {
    example: ExampleRecord;
    size?: 'tile' | 'row';
}) {
    const [failed, setFailed] = useState(false);
    const url = thumbnailUrl(example, isAvailable);
    return (
        <span className="Thumbnail" data-size={size} aria-hidden="true">
            {url && !failed
                ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
                : <FileText {...iconProps} />}
        </span>
    );
}
