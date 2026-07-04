import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17231c",
        cream: "#f5f6f1",
        forest: "#1f6b45",
        lime: "#dff05a",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(28, 48, 37, 0.14)",
      },
    },
  },
  plugins: [],
} satisfies Config;
