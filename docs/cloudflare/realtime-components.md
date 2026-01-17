# Cloudflare RealtimeKit UI

Read on to understand the project and how you can get started, or open up the section:

- [UI Config](./config.md)

## Project Structure

Each component resides in a folder of their own, like: `src/components/my-component`.

You can create a new component by running:

```sh
npm run generate my-component
```

This will create 4 files:

```sh
├── my-component
│   ├── my-component.css
│   ├── my-component.tsx
│   └── test
│       ├── my-component.e2e.ts
│       └── my-component.spec.tsx
```

The test files are optional, which you can omit at first and add later.

## Styling components

We handle the design tokens with the help of tailwindcss.

The entire design system is defined in the [tailwindcss config](../tailwind.config.js).

> Note that you can use ordinary css along with tailwindcss' `@apply` directive and `theme()`.

> Tip: You can nest css selectors thanks to the `tailwindcss/nesting` plugin!

You can use these styles in css files like:

```css
:host {
  /** @apply directive */
  @apply bg-brand-500 flex items-center justify-center;
  /** or you can use the theme values with theme() */
  border-left: theme('borderWidths.sm') solid theme('colors.brand.500');
}
```

### Responsiveness

The `size` prop for all components are reflected in the DOM, so you can set styles by using the css selector as:

```css
:host([size='sm']) {
  @apply inline;
}
```

### Styling for slotted components

You can use the [`::slotted()`](https://developer.mozilla.org/en-US/docs/Web/CSS/::slotted) pseudo-element to apply styles on any slotted components, i.e; elements which are added to an element via a slot.

For example, `<rtk-name-tag>` is added inside the slot of `<rtk-peer-view>`, so you can style `rtk-name-tag` inside `rtk-peer-view.css` as follows:

```css
:host(::slotted(rtk-name-tag)) {
  @apply absolute top-3 left-3;
}
```

## Hierarchy of components

### Top level component

This is just the one top level component: `rtk-meeting` which just takes a meeting object and loads your server rendered config and renders the entire UI based on it.

### Mid level component

These are components like `rtk-header`, `rtk-stage`, `rtk-controlbar` which are essential containers for the low-level components and have some state within, like for example:

`rtk-stage` can have a sidebar as well as plugins with the default grid. So there will be states in the component which will handle these states and render components accordingly.

### Low level component

These are all the lowest level components or units which help make a full meeting UI.

These are:

- rtk-mic-toggle
- rtk-camera-toggle
- rtk-logo
- ... and many more

These components will take in some default props via attributes:

```ts
interface DefaultProps {
  meeting: RealtimeKitClient;
  config?: UIConfig;
  size?: Size;
  states?: States;
  iconPack?: IconPack;
  t?: LangDict;
}
```

Some important points:

- The meeting object is required for all components.
- The config object is optional, as only a few components will need it
  - like `<rtk-icon>` will need the config object to render the logo
- The `size` prop can be used for styling your component for different breakpoints and also for using in structuring your component
- The `iconPack` prop is optional, and if you don't pass it, it will use the `defaultIconPack` which is an icon set from [fluent-icons](https://fluenticons.co/outlined/)
- The `t` prop is optional, uses `defaultLanguage` by default.
- The `states` prop is optional and is passed down from `<rtk-meeting>` component which has all the states which are needed for a meeting.

## Handling imports in StencilJS

Stencil requires all imports to be named, and gives an error otherwise when running.

So, commonly used types from `web-core` and others are named exports from the `types` directory.

- [`rtk-client.ts`](../src/types/rtk-client.ts) consists of types & exports which are required from the `@cloudflare/realtimekit` package.
- [`props.ts`](../src/types/props.ts) consists of a set of types which are commonly used by components like `Size`, `States`.
- [`ui-config/*.ts`](../src/types/ui-config) consists of types for the UI Config.

These icons are fetched and merged with the default icon pack to handle missing icons and is passed down to individual components.

Note that only the `rtk-meeting` components accepts the URL, all other components accept the `iconPack` prop, which is just the object downloaded from the URL.

## Language

You can pass a language object as a prop `t` to `rtk-meeting` as:

> We cannot use the `lang` attribute as it is a reserved attribute which stencil doesn't allow to be used a prop in our components.

```jsx
<RtkMeeting
  t={useLanguage({
    ended: 'Ended',
  })}
/>
```

# UI Config

You can take a look at the [Default UI Config](../src/lib/default-ui-config.ts) for reference.

The UI is divided into three parts:

1. Design Tokens
2. Styles
3. Tree/Root

## Design Tokens

Users can define the tokens in the UI from here.

| Property       | Default     | Note                                                                                         |
| -------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `spacingBase`  | 4           | The base for the spacing scale                                                               |
| `fontFamily`   | `none`      | Sets a custom font-family                                                                    |
| `googleFont`   | `none`      | Loads and sets a font from [Google Fonts](https://fonts.google.com), example value: `"Lato"` |
| `borderWidth`  | `"thin"`    | Sets a set of border-widths to use app-wide. Values: `none`, `thin`, `fat`                   |
| `borderRadius` | `"rounded"` | `sharp`, `rounded`, `extra-rounded`, `circular`                                              |
| `logo`         | `none`      | A custom logo URL                                                                            |
| `colors`       | `none`      | Color palette                                                                                |

The `colors` property is an object which specifies all the colors required. You can specify only a subset of colors if you just want to update the specific shade as the default colors are merged with this object, so as to fill any missing voids.

```ts
interface UIColors {
  brand?: {
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
  };
  background?: {
    1000: string;
    900: string;
    800: string;
    700: string;
    600: string;
  };
  text?: string;
  videoBg?: string;
  danger?: string;
  success?: string;
  warning?: string;
}
```

## Styles

You can set your own CSS for RTK components or simple HTML elements which you will use in the tree. You can also set styles for a specific state, or a specific screen size.

Example:

```json
{
  "rtk-meeting": {
    "display": "flex"
  },
  "rtk-meeting.sm": {
    "flexDirection": "column"
  },
  "rtk-meeting[meeting=idle]": {
    "display": "block"
  },
  "div#header-center": {
    "justifyContent": "center"
  }
}
```

## Tree (root)

The tree is the hierarchy of components which the renderer inside `rtk-meeting` will accept and it uses it to render the entire UI.

You can:

- Specify based on states
- Specific screen breakpoints
- Pass props

Each property can be an object, or an array of strings or array.

The object can have `props` and `children`.

The array can have just strings which are the component names, or it can be an array/tuple with first value being the name, the second being an object with props.

Example:

```json
{
  "rtk-meeting[meeting=joined]": ["rtk-header", "rtk-stage", "rtk-controlbar"],
  "rtk-header": {
    "props": {
      "variant": "boxed"
    },
    "children": ["div#header-left", "div#header-center", "div#header-right"]
  },
  "div#header-left": [["rtk-participant-count", { "variant": "boxed" }]]
}
```