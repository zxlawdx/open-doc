/* ============ VELA OFFLINE TAILWIND ============ */
module.exports = {
  content: [
    "./apps/home/templates/**/*.html", "./apps/home/static/js/*.js",
    "./.vela-build/framework-shell.html"
  ],
  corePlugins: {preflight: false},
  theme: {extend: {}},
  plugins: []
};
