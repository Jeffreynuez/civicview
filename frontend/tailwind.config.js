/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1b263b', light: '#415a77' },
        accent: { DEFAULT: '#2d6a4f', light: '#40916c' },
        republican: '#e63946',
        democrat: '#457b9d',
      },
    },
  },
  plugins: [],
};
