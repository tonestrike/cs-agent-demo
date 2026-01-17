import type { CSSProperties, HTMLAttributes, RefAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "rtk-chat": HTMLAttributes<HTMLElement> &
        RefAttributes<HTMLElement> & {
        meeting?: unknown;
        style?: CSSProperties;
      };
      "rtk-mic-toggle": HTMLAttributes<HTMLElement> &
        RefAttributes<HTMLElement> & {
        meeting?: unknown;
        size?: string;
      };
    }
  }
}
