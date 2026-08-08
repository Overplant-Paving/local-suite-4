# Local Suite v4.3.2

Local Suite v4.3.2 adds **Audio Transfer** as the 103rd manifest tool and introduces the new **Beta Tools** hub category.

## Audio Transfer beta

- Separate `audio.html` Send/Receive tool; Optical Transfer remains unchanged.
- Arbitrary binary file transfer over the physical speaker-to-microphone path.
- Audible C0/R1 BPSK OFDM with preambles, training, pilots, convolutional FEC, interleaving, duplicated protected headers, and CRC32C.
- 512-byte source blocks with bounded systematic robust-soliton/XOR fountain recovery. The first
  `k` DATA equations are degree-one source blocks, followed by a whole-file parity equation and
  bounded robust-soliton parity, so the finite schedule always reconstructs without packet loss and
  recovers any one missing systematic packet.
- Repeated manifest/final identity and SHA-256-gated reconstruction; no download is exposed for corrupt or incomplete data.
- 1 MiB file ceiling, bounded receiver queue, and bounded acquisition/search limits.
- No payload upload, relay, account, or network data path.
- Hosted HTTPS/PWA is the supported mobile microphone-receive path; the generated direct-file sender remains self-contained.

## Suite integration

- 103 manifest tools plus the generated hub: 104 HTML pages.
- New `🧪 Beta Tools` category contains Audio Transfer as a distinct card.
- PWA precache contains 108 entries.
- Pages CI now runs the focused Audio Transfer browser gate.
- Existing v4.3.1 Optical Transfer hardening and all other tools are retained.

## Verification

Release evidence and command output are archived in this directory. The deterministic modem gate verifies exact C0/R1 encode/decode at both 44.1 and 48 kHz, including acquisition after a 6,144-sample pre-roll. The focused browser gate verifies the complete finite fountain schedule across 143 deterministic file/session cases from one block through the 1 MiB ceiling, plus 100 one-systematic-packet-loss cases; hub placement, bounded transfer limits, real WebAudio startup, microphone state, deterministic SHA-256-gated reconstruction, mismatch withholding, generated CSP, direct-file sender behavior, and zero console/page errors. The explicit physical-hardware script remains opt-in, derives its deadline from the selected transfer size, and is not part of broad CI.
