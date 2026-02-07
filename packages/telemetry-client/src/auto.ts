// Auto-initialize telemetry capture on import
// Usage: import '@chriscode/devmux-telemetry/auto' at the TOP of your entry file

import { installBufferedConsoleCapture } from "./capture/console.js";
import { installBufferedErrorCapture } from "./capture/errors.js";

// Install buffered capture immediately - this runs as soon as the module is imported
installBufferedConsoleCapture();
installBufferedErrorCapture();

// Re-export everything from the main index so users can still access the API
export * from "./index.js";
