/**
 * DorkFi Harbormaster LaaS — Entry Point
 * Starts both the API server and the monitor loop.
 */

import './lib/env.mjs';
import { startApi } from './api.mjs';
import { startMonitor } from './monitor.mjs';
import { log } from './lib/notify.mjs';

log('═══════════════════════════════════════════');
log('  DorkFi Harbormaster LaaS');
log('  Liquidation Protection as a Service');
log('═══════════════════════════════════════════');

startApi();
startMonitor();
