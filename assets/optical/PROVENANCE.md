# Optical Transfer provenance and third-party notices

Local Suite's Optical Transfer is an independent adaptation of the protocol,
container checks, deterministic LT fountain implementation, animated QR sender,
and camera/worker recovery architecture from **Decimen Optical Transfer**.

- Upstream repository: `bashalarmistalt/decimen-optical-transfer`
- Audited read-only snapshot: `ed4cbcf558b80913fcba2e91193f71801f8e919c`
- Upstream package version at that snapshot: `0.2.0`
- Upstream license: MIT
- Adaptation changes: one-page Local Suite UI, 16 MB memory ceiling, safer 1,465
  byte / 24 FPS defaults, stricter pre-allocation frame validation, bounded metadata,
  filename and media-type hardening, two-frame session replacement isolation,
  scoped Local Suite CSP, and deterministic browser integration tests.

The vendored artifacts were taken or derived only from the pinned snapshot's
already-installed/build outputs. Local Suite has no build-time or runtime package
requirement for them.

| Local file | Origin | SHA-256 |
|---|---|---|
| `qrcode.js` | Browser bundle generated from snapshot's installed `qrcode` 1.5.4 | `7bbbad9682b828624bae5da8f9cf8b7d76ddf520f59036e756070a924f9c1adc` |
| `zxing-worker.js` | Snapshot `dist/assets/worker-CsypDvX1.js` | `c54e6831041d520102d42c0b4cf8725861d5ab9752dbefd32edb6686e0e5a81f` |
| `zxing_reader.wasm` | Snapshot `dist/assets/zxing_reader-EOacYbLr.wasm` | `85d46f55d7c86a4d09bb04273367408b19c324f582d040d018aecb25a9a82942` |

The worker identifies zxing-wasm 2.2.4. That package pins ZXing-C++ commit
`fba4e9503fee4518ca2e89510baeea9bcc36dc8d`. The built reader WASM is inlined
as a data URI and the worker is inlined as a Blob in generated `optical.html`;
neither produces an external runtime request.

## Decimen Optical Transfer — MIT

Copyright (c) 2026 BashAlarmist

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## node-qrcode — MIT

Copyright (c) 2012 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## dijkstrajs (bundled by node-qrcode) — MIT

Dijkstra path-finding functions. Adapted from the Dijkstar Python project.

Copyright (C) 2008 Wyatt Baldwin <self@wyattbaldwin.com>
All rights reserved.

Licensed under the MIT license.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## zxing-wasm specific code — MIT

Copyright (c) 2023 Ze-Zheng Wu

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

ZXing-C++ and the WASM reader wrapper include Apache-2.0-licensed code. The full
license is preserved in [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0).
