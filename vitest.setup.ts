import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Initialize wrangler environment for tests.
 * This ensures workerd and D1 bindings are ready before tests run.
 */
const initializeWrangler = (): void => {
  // Create wrangler state directory if it doesn't exist
  const wranglerStateDir = ".wrangler/state/v3";
  if (!existsSync(wranglerStateDir)) {
    mkdirSync(wranglerStateDir, { recursive: true });
  }

  // Warm up wrangler to ensure workerd binary is downloaded and initialized
  // This prevents timeouts during test execution
  try {
    execSync("npx wrangler --version", {
      stdio: "pipe",
      timeout: 30000,
    });
  } catch (error) {
    console.warn("Warning: Failed to initialize wrangler:", error);
  }
};

// Run initialization before all tests
initializeWrangler();
