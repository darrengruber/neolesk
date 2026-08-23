import { browserRendererAdapters } from './browserAdapters';
import { createRendererCatalog } from './rendering';

export const browserRendererCatalog = createRendererCatalog(browserRendererAdapters);
