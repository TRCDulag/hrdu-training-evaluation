# Puts the logos and the QR code library into src/index.src.html and writes index.html.
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
logos = json.loads((root / "dev" / "logos.json").read_text())
html = (root / "src" / "index.src.html").read_text()
logos["QRCODE_LIB"] = (root / "dev" / "vendor" / "qrcode.min.js").read_text()   # QR Code Generator, Kazuhiko Arase, MIT
for k, v in logos.items():
    html = html.replace("%%" + k + "%%", v)
(root / "index.html").write_text(html)
print("index.html", len(html))
