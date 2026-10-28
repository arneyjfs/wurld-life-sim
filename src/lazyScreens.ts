import { lazy } from 'react';

/** Route-level code splitting: each life screen is its own chunk. */
export const LifeOverviewScreen = lazy(() =>
  import('./screens/LifeScreen/LifeOverviewScreen').then((m) => ({ default: m.LifeOverviewScreen })),
);
export const LifeStartScreen = lazy(() =>
  import('./screens/LifeScreen/LifeStartScreen').then((m) => ({ default: m.LifeStartScreen })),
);
export const LifeScreen = lazy(() =>
  import('./screens/LifeScreen/LifeScreen').then((m) => ({ default: m.LifeScreen })),
);
