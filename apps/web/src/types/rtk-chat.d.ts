import type { CSSProperties, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "rtk-chat": HTMLAttributes<HTMLElement> & {
        meeting?: unknown;
        style?: CSSProperties;
      };
      "rtk-mic-toggle": HTMLAttributes<HTMLElement> & {
        meeting?: unknown;
        size?: string;
      };
    }
  }
}
