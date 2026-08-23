import { browserRendererAdapters, workerRendererAdapters } from './browserAdapters';
import { createRendererCatalog } from './rendering';

export const browserRendererCatalog = createRendererCatalog(browserRendererAdapters);
export const workerRendererCatalog = createRendererCatalog(workerRendererAdapters);
