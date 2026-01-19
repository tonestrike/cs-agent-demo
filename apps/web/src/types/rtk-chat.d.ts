import type { JSX as RtkJSX } from "@cloudflare/realtimekit-ui";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type RtkElement<T> = DetailedHTMLProps<HTMLAttributes<T>, T>;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "rtk-chat": RtkElement<HTMLRtkChatElement> & RtkJSX.RtkChat;
      "rtk-mic-toggle": RtkElement<HTMLRtkMicToggleElement> &
        RtkJSX.RtkMicToggle;
    }
  }
}
