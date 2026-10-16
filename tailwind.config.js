/* ============ VELA OFFLINE TAILWIND ============ */
module.exports = {
  content: [
    "./apps/open_doc/templates/**/*.html", "./apps/open_doc/static/js/*.js",
    "./.vela-build/framework-shell.html"
  ],
  corePlugins: {preflight: false},
  theme: {extend: {}},
  plugins: []
};
