"""Run the DOCX list regression with real Qt keyboard events and CDP screenshots."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from qa_version_history import wait

import webview

from apps.open_doc.services.container import services
from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app
from qa_runtime import Keyboard, report
from docx import Document


def capture(output, name):
    subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            """
            import {writeFileSync} from 'node:fs';
            const [port, target] = process.argv.slice(1);
            const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
            const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
              ws.onerror = reject;
              ws.onopen = () => ws.send(JSON.stringify({
                id: 1, method: 'Emulation.setDeviceMetricsOverride',
                params: {width: 1366, height: 768, deviceScaleFactor: 1, mobile: false}
              }));
              ws.onmessage = ({data}) => {
                const response = JSON.parse(data);
                if (response.error) reject(Error(JSON.stringify(response.error)));
                if (response.id === 1) ws.send(JSON.stringify({
                  id: 2, method: 'Page.captureScreenshot', params: {format: 'png'}
                }));
                if (response.id === 2) {
                  writeFileSync(target, Buffer.from(response.result.data, 'base64'));
                  resolve();
                }
              };
            }).finally(() => ws.close());
            """,
            os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
            str(output / f"{name}.png"),
        ],
        check=True,
        timeout=20,
    )


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    def exercise():
        window = webview.windows[0]
        try:
            report(window)
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            keyboard = Keyboard(window)
            for command, markers in [("list", ["•", "•"]), ("ordered", ["1.", "2."])]:
                document = Document()
                document.add_paragraph("Primeiro item")
                fixture = services().config.root / f"qa-{command}.docx"
                document.save(fixture)
                note = services().editor.import_docx(fixture)
                window.evaluate_js(f"OpenDocApp.editor().load({json.dumps(note)})")
                wait(
                    window,
                    "document.querySelector('[data-rich] p')?.textContent === 'Primeiro item'",
                )
                window.evaluate_js("""
                    (() => {
                      const rich=document.querySelector('[data-rich]');
                      const run=rich.querySelector('p [data-node-type=text]').firstChild;
                      rich.focus();
                      getSelection().collapse(run,run.length);
                      OpenDocApp.editor().capture();
                    })()
                """)
                window.evaluate_js(
                    f"document.querySelector('.toolbar [data-command={command}]').click()"
                )
                wait(
                    window, "document.querySelectorAll('[data-list-marker]').length===1"
                )
                keyboard.key("Return")
                keyboard.type("Segundo item")
                capture(output, command)
                actual = window.evaluate_js("""
                    (() => ({
                      markers:Array.from(document.querySelectorAll('[data-list-marker]'),
                        marker=>marker.textContent),
                      items:OpenDocApp.editor().snapshot().content.blocks.map(
                        block=>(block.children||[]).map(run=>run.text||'').join(''))
                    }))()
                """)
                print(
                    "QT_DOCX_LIST",
                    command,
                    json.dumps(actual, ensure_ascii=False),
                    flush=True,
                )
                assert actual["markers"] == markers, actual
                assert actual["items"] == ["Primeiro item", "Segundo item"], actual
                keyboard.key("Return")
                wait(
                    window, "document.querySelectorAll('[data-list-marker]').length===3"
                )
                keyboard.key("Return")
                wait(
                    window,
                    """
                    (() => {
                      const blocks=OpenDocApp.editor().snapshot().content.blocks;
                      return blocks.length===3 && blocks[1].list_info && !blocks[2].list_info &&
                        document.querySelectorAll('[data-list-marker]').length===2;
                    })()
                """,
                ), "Enter on an empty item must exit the list"
            window.evaluate_js("""
                (() => {
                  const rich=document.querySelector('[data-rich]');
                  const run=rich.querySelector('[data-list-info] [data-node-type=text]').firstChild;
                  rich.focus();
                  getSelection().collapse(run,0);
                })()
            """)
            keyboard.key("Tab")
            wait(
                window,
                """(() => {
                const first=OpenDocApp.editor().snapshot().content.blocks[0];
                return first.list_info.level===1 && first.children.length===1 &&
                  first.children[0].text==='Primeiro item';
            })()""",
            )
            capture(output, "ordered-nested")
            keyboard.key("Tab", shift=True)
            wait(
                window,
                """OpenDocApp.editor().snapshot().content.blocks[0].list_info.level===0""",
            )
            print("QT_DOCX_LIST_NESTING_WITHOUT_INSERTING_TAB_OK", flush=True)
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    def start(*args, **kwargs):
        native_start(exercise, gui="qt", debug=False)

    webview.start = start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-list-qa-") as directory:
            create_app(Config(Path(directory))).run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()
