/// <reference types="vite/client" />

import type { ClaudePetBridge } from "../shared/types";

declare global {
  interface Window {
    /** Bridge exposed by the preload (absent in a static browser preview). */
    claudePet?: ClaudePetBridge;
  }
}

export {};
