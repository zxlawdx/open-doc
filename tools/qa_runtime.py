"""Public runtime facts only; never log user document text."""

import json
import platform
import sys
from importlib.metadata import version
from PyQt5.QtCore import QT_VERSION_STR, PYQT_VERSION_STR


def report(window):
    print(
        "OPEN_DOC_QA_RUNTIME",
        json.dumps(
            {
                "os": platform.platform(),
                "python": sys.version.split()[0],
                "pyqt": PYQT_VERSION_STR,
                "qt": QT_VERSION_STR,
                "qtwebengine_package": version("PyQtWebEngine"),
                "qtwebengine_runtime": version("PyQtWebEngine-Qt5"),
                "ua": window.evaluate_js("navigator.userAgent"),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


class Keyboard:
    """Send real QTest shortcuts to the WebEngine focus proxy on the GUI thread."""

    def __init__(self, window):
        from threading import Event
        from PyQt5.QtCore import QObject, Qt, pyqtSignal, pyqtSlot
        from PyQt5.QtTest import QTest
        from PyQt5.QtWidgets import QApplication
        from webview.platforms.qt import BrowserView

        class Driver(QObject):
            requested = pyqtSignal(str)
            typing = pyqtSignal(str)

            def __init__(self, view):
                super().__init__()
                self.view = view
                self.done = Event()
                self.requested.connect(self.perform)
                self.typing.connect(self.type_text)

            @pyqtSlot(str)
            def type_text(self, text):
                target = self.view.focusProxy() or self.view
                target.setFocus()
                QTest.keyClicks(target, text)
                self.done.set()

            @pyqtSlot(str)
            def perform(self, key):
                target = self.view.focusProxy() or self.view
                target.setFocus()
                QTest.keyClick(target, getattr(Qt, "Key_" + key), Qt.ControlModifier)
                self.done.set()

        self.driver = Driver(BrowserView.instances[window.uid].webview)
        self.driver.moveToThread(QApplication.instance().thread())

    def press(self, key):
        self.driver.done.clear()
        self.driver.requested.emit(key)
        if not self.driver.done.wait(5):
            raise AssertionError("Qt shortcut timeout: " + key)

    def type(self, text):
        self.driver.done.clear()
        self.driver.typing.emit(text)
        if not self.driver.done.wait(5):
            raise AssertionError("Qt typing timeout")
