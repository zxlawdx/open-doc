/* ============ VELA OFFLINE TAILWIND ============ */
module.exports = {
  content: [
    "./ui/templates/**/*.html", "./ui/static/js/*.js",
    "./.vela-build/framework-shell.html"
  ],
  corePlugins: {preflight: false},
  theme: {extend: {}},
  plugins: []
};
