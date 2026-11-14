"""Measure native dataset import/render/paging at the four required scales."""

import json
import platform
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

from qa_docx_list import capture
from qa_runtime import report
from config.wsgi import create_app
from shared.services.preferences_service import Config
import webview


def wait(window, expression, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if window.evaluate_js(expression):
            return
        time.sleep(0.05)
    raise AssertionError(expression + " — " + str(window.evaluate_js(
        "document.querySelector('[data-dataset-status]')?.textContent")))


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    native_start = webview.start
    started = time.perf_counter()
    with TemporaryDirectory(prefix="opendoc-scale-") as directory:
        root = Path(directory)

        def exercise():
            window = webview.windows[0]
            picker = window.create_file_dialog
            js = window.evaluate_js
            try:
                wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
                startup = (time.perf_counter() - started) * 1000
                report(window)
                js("document.querySelector('[data-action=datasets]').click()")
                wait(window, "!document.querySelector('[data-dataset]').hidden && !document.querySelector('[data-dataset-command=new]').disabled")
                for count in (1000, 10000, 100000, 1000000):
                    source = root / f"scale-{count}.csv"
                    with source.open("w", encoding="utf-8") as stream:
                        stream.write("id,value\n")
                        for number in range(count):
                            stream.write(f"{number},{number * 2}\n")
                    window.create_file_dialog = lambda *a, **kw: (str(source),)
                    js("""window.__scale={start:performance.now(),last:performance.now(),ticks:0,maxDelay:0};
                        window.__scaleTimer=setInterval(()=>{const now=performance.now();
                        __scale.maxDelay=Math.max(__scale.maxDelay,now-__scale.last);__scale.last=now;__scale.ticks++;},16);
                        document.querySelector('[data-dataset-command=new]').click();""")
                    wait(window, f"document.querySelector('[data-dataset-list]').selectedOptions[0]?.textContent==='scale-{count}' && !document.querySelector('[data-dataset-command=new]').disabled")
                    measured = js("clearInterval(__scaleTimer);({...__scale,import_render_ms:performance.now()-__scale.start,dom_rows:document.querySelectorAll('[data-dataset-table] tbody tr').length})")
                    assert measured["dom_rows"] == 50, measured
                    if count >= 100000:
                        assert measured["ticks"] > 0, measured
                    middle = count // 2
                    begin = time.perf_counter()
                    js(f"document.querySelector('[data-dataset-row]').value='{middle + 1}';document.querySelector('[data-dataset-command=go]').click()")
                    wait(window, f"document.querySelector('[data-dataset-table] td')?.textContent==='{middle}'")
                    measured["page_render_ms"] = (time.perf_counter() - begin) * 1000
                    measured["records"] = count
                    try:
                        import psutil
                        process = psutil.Process()
                        measured["python_qt_rss_bytes"] = process.memory_info().rss
                        measured["child_rss_bytes"] = sum(p.memory_info().rss for p in process.children(recursive=True))
                    except Exception as error:
                        measured["rss_unavailable"] = type(error).__name__
                    results.append(measured)
                    print("QT_DATA_SCALE", json.dumps(measured), flush=True)
                capture(output, "million-records")
                (output / "scale-metrics.json").write_text(json.dumps({
                    "platform": platform.platform(), "startup_to_ready_ms": startup,
                    "scope": "single native Qt run; import includes bridge, SQLite and render; RSS includes warm imports; no GUI baseline",
                    "results": results,
                }, indent=2), encoding="utf-8")
            except Exception as error:
                errors.append(error)
            finally:
                window.create_file_dialog = picker
                window.confirm_close = False
                window.destroy()

        webview.start = lambda *a, **kw: native_start(exercise, gui="qt", debug=False)
        try:
            create_app(Config(root / "workspace"), start_in_library=True).run()
        finally:
            webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()
