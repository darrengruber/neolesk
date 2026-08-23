import { createRendererCatalog } from './rendering';
import { workerRendererAdapters } from './workerAdapters';

export const workerRendererCatalog = createRendererCatalog(workerRendererAdapters);
