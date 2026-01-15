import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0C1B1F",
        sand: "#F6F1E7",
        amber: "#F5A524",
        moss: "#2F5D50",
        clay: "#C96A4B",
        slate: "#1D2A2E",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(12, 27, 31, 0.18)",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
