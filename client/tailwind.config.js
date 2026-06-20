/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101820",
        moss: "#496A4A",
        signal: "#C7522A",
        mist: "#EEF3EF",
        line: "#D8E1DA"
      },
      boxShadow: {
        lift: "0 12px 30px rgba(16, 24, 32, 0.08)"
      }
    }
  },
  plugins: []
};
