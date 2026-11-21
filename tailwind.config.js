/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#0a0a0b",
          panel: "#101013",
          elevated: "#16161b",
          border: "#24242b",
        },
        accent: {
          DEFAULT: "#7c5cff",
          hover: "#6b4bf0",
          glow: "#9d83ff",
        },
        ok: "#34d399",
        warn: "#fbbf24",
        err: "#f87171",
        mute: "#8a8a96",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,0.25), 0 0 24px rgba(124,92,255,0.18)",
      },
    },
  },
  plugins: [],
};
