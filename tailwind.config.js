
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0b0b",
        accent: "#FFD000",
      },
      dropShadow: {
        logo: "0 1px 1px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.7)"
      }
    },
  },
  plugins: [],
}
