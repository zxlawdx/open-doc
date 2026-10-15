/* ============ OFFLINE TAILWIND ============ */
module.exports = {
  content: ["./ui/templates/**/*.html", "./ui/static/js/**/*.js"],
  corePlugins: {preflight: false},
  theme: {extend: {}},
  plugins: []
};
