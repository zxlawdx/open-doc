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
            typing = pyqtSignal(str, int)
            plain = pyqtSignal(str, bool)

            def __init__(self, view):
                super().__init__()
                self.view = view
                self.done = Event()
                self.requested.connect(self.perform)
                self.typing.connect(self.type_text)
                self.plain.connect(self.type_key)

            @pyqtSlot(str, int)
            def type_text(self, text, delay):
                from PyQt5.QtGui import QInputMethodEvent

                target = self.view.focusProxy() or self.view
                target.setFocus()
                for char in text:
                    if ord(char) < 128:
                        QTest.keyClicks(target, char)
                    else:
                        preedit = QInputMethodEvent(char, [])
                        QApplication.sendEvent(target, preedit)
                        commit = QInputMethodEvent()
                        commit.setCommitString(char)
                        QApplication.sendEvent(target, commit)
                    if delay:
                        QTest.qWait(delay)
                self.done.set()

            @pyqtSlot(str, bool)
            def type_key(self, key, shift):
                target = self.view.focusProxy() or self.view
                QTest.keyClick(
                    target,
                    getattr(Qt, "Key_" + key),
                    Qt.ShiftModifier if shift else Qt.NoModifier,
                )
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

    def type(self, text, delay=0):
        self.driver.done.clear()
        self.driver.typing.emit(text, delay)
        if not self.driver.done.wait(max(5, len(text) * delay / 1000 + 5)):
            raise AssertionError("Qt typing timeout")

    def key(self, key, shift=False):
        self.driver.done.clear()
        self.driver.plain.emit(key, shift)
        if not self.driver.done.wait(5):
            raise AssertionError("Qt key timeout: " + key)
