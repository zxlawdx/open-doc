"""Static analyzer source executed by the project interpreter in frozen builds."""

SOURCE = r'''
"""Static Jedi analysis inside the project interpreter; never execute editor code."""
import json
import os
import subprocess
import sys

if os.name == "nt":
    class HiddenPopen(subprocess.Popen):
        def __init__(self, *args, **kwargs):
            kwargs["creationflags"] = kwargs.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
            super().__init__(*args, **kwargs)
    subprocess.Popen = HiddenPopen
import jedi
code,line,column,operation=json.load(sys.stdin)
script=jedi.Script(code)
if operation == "complete":
    result={"items":[{"label":x.name,"type":x.type} for x in script.complete(line,column)[:100]]}
elif operation == "diagnostics":
    result={"items":[{"line":x.line,"column":x.column,"message":x.get_message()} for x in script.get_syntax_errors()[:30]]}
else:
    signatures=script.get_signatures(line,column); names=script.help(line,column)
    result={"signature":signatures[0].to_string() if signatures else "", "documentation":names[0].docstring(raw=True)[:4000] if names else ""}
print(json.dumps(result))

'''
