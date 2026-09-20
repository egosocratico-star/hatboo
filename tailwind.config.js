/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: "#0b0b10",
          raised: "#12121a",
          border: "#22222e",
          hover: "#1a1a24",
        },
        accent: {
          DEFAULT: "#8b5cf6",
          soft: "#a78bfa",
          dim: "#6d3fd4",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
