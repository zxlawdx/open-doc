"""A local asset build must never dirty versioned stylesheets."""

from pathlib import Path

import tools.build_css as builder


def test_collectstatic_css_hook_writes_only_untracked_runtime(monkeypatch, tmp_path: Path):
    styles = tmp_path / "apps/open_doc/styles"
    styles.mkdir(parents=True)
    (styles / "tokens.css").write_text("/* original theme */\n", encoding="utf-8")
    (styles / "shell.css").write_text(".open-doc { color: red; }\n", encoding="utf-8")
    css = tmp_path / "apps/open_doc/static/css"
    css.mkdir(parents=True)
    seed = css / "main.css"
    seed.write_text("/* committed seed; do not rewrite */\n", encoding="utf-8")

    def fake_tailwind(root, output, *, minify):
        assert root == str(tmp_path)
        assert minify is True
        target = Path(output) / "css/vela.bundle.css"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("/* Tailwind utilities */\n\n", encoding="utf-8")
        return True

    monkeypatch.setattr(builder, "ROOT", tmp_path)
    monkeypatch.setattr(builder, "STYLE_ORDER", ("tokens.css", "shell.css"))
    monkeypatch.setattr(builder, "run_tailwind_pipeline", fake_tailwind)
    builder.main()
    runtime = css / "runtime.css"
    assert seed.read_text(encoding="utf-8") == "/* committed seed; do not rewrite */\n"
    assert runtime.read_text(encoding="utf-8") == (
        "/* Tailwind utilities */\n"
        "/* original theme */\n\n"
        ".open-doc { color: red; }\n\n"
    )
    assert not (css / "runtime.css.tmp").exists()


def test_generated_css_is_ignored_and_template_uses_it():
    root = Path(__file__).resolve().parents[1]
    ignored = (root / ".gitignore").read_text(encoding="utf-8")
    template = (root / "apps/open_doc/templates/base.html").read_text(encoding="utf-8")
    assert "/apps/open_doc/static/css/runtime.css" in ignored
    assert "open_doc/css/runtime.css" in template
