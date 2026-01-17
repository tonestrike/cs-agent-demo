import type { CSSProperties, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "rtk-chat": HTMLAttributes<HTMLElement> & {
        meeting?: unknown;
        style?: CSSProperties;
      };
    }
  }
}
