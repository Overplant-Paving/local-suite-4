# Acoustic Modem DSP Design

Status: Stage A3 initial design; parameter lock is blocked by the feasibility gates
Required baseline: robust audible control plus audible OFDM BPSK/QPSK data

## 1. Evidence posture

The values below are defensible starting parameters and deterministic test inputs. They are not
measurements, compatibility promises, or final performance settings. Profile IDs reserve meanings;
a profile may remain disabled if a gate fails. Changing the waveform behind an enabled ID after
parameter lock requires a protocol-minor change or a new profile ID.

Physical compatibility remains unverified. Speaker/microphone response, room delay spread, EC/NS/
AGC behavior, clipping, clock drift, reverse-link timing, audibility, and goodput require actual
hardware evidence.

## 2. Sampling grids and carrier derivation

The AudioWorklet reports the actual `AudioContext.sampleRate`; it is never assumed to equal a
physical microphone clock. Protocol v1 supports two PHY grid rates, 44,100 and 48,000 Hz, with
`N=512`. A transmitter announces its grid. A receiver searches both control-grid hypotheses during
discovery, then resamples captured context samples to the announced grid and tracks residual SRO.

If an actual context rate is neither supported grid, a bounded rational/polyphase resampler may map
to a supported grid only after its spike passes. Otherwise the runtime fails visibly. At 88.2/96 kHz
a future implementation may use `N=1024`; that is not v1 launch support.

For profile band `[fLo,fHi]`:

```text
deltaF = gridSampleRate / N
kLo = ceil(fLo / deltaF)
kHi = floor(min(fHi, 0.45 * gridSampleRate) / deltaF)
```

Positive-frequency bins `kLo..kHi` are candidates. The lowest two and highest two are null edge
guards. Starting at the first remaining bin, every eighth bin is a BPSK pilot; all other remaining
bins are data. DC, Nyquist, edge guards, and all unspecified bins are zero. Negative-frequency bins
are Hermitian conjugates so the IFFT output is real.

### Exact v1 carrier-plan vectors (`N=512`)

Each cell is `candidate bins; usable / pilot / data counts` after the two-bin edge guards.

| Profile | 44,100 Hz (`deltaF=86.1328125 Hz`) | 48,000 Hz (`deltaF=93.75 Hz`) |
|---|---|---|
| C0 1.5–5.5 kHz | `18..63; 42 / 6 / 36` | `16..58; 39 / 5 / 34` |
| R1 1.2–7.2 kHz | `14..83; 66 / 9 / 57` | `13..76; 60 / 8 / 52` |
| R2 1.0–10.0 kHz | `12..116; 101 / 13 / 88` | `11..106; 92 / 12 / 80` |
| A2 1.2–8.5 kHz | `14..98; 81 / 11 / 70` | `13..90; 74 / 10 / 64` |
| A3 1.0–12.0 kHz | `12..139; 124 / 16 / 108` | `11..128; 114 / 15 / 99` |
| X1 17.2–20.2 kHz, Nyquist-capped | `200..230; 27 / 4 / 23` | `184..215; 28 / 4 / 24` |
| W1 0.5–20.0 kHz, Nyquist-capped | `6..230; 221 / 28 / 193` | `6..213; 204 / 26 / 178` |

At 44.1 kHz the useful symbol is approximately 11.61 ms; at 48 kHz it is approximately
10.67 ms. The receiver resamples to the transmitter's grid rather than treating that 8.8% nominal
difference as ordinary clock drift.

## 3. Profile registry

| ID | Name | Purpose | Modulation / body FEC | CP | Initial status |
|---:|---|---|---|---|---|
| `0x01` | `C0` | discovery, negotiation, manifest control, ACK, errors | BPSK / K7 rate 1/2; robust repetition | 1/4 N = 128 | mandatory spike profile |
| `0x10` | `R1` | robust audible DATA | BPSK / K7 rate 1/2 | 1/4 N = 128 | mandatory baseline |
| `0x11` | `R2` | higher-rate robust audible DATA | BPSK / K7 rate 2/3 | 1/8 N = 64 | disabled until puncture/channel gates |
| `0x20` | `A2` | normal audible DATA | QPSK / K7 rate 2/3 | 1/8 N = 64 | mandatory target, gated |
| `0x21` | `A3` | fast audible DATA | QPSK / K7 rate 3/4 | 1/16 N = 32 | disabled until physical R1/A2 success |
| `0x30` | `X1` | near-ultrasonic experiment | BPSK or QPSK / rate 1/2–2/3 | 1/8 N = 64 | hidden/disabled; separate hardware gate |
| `0x40` | `W1` | wired/stretch experiment | QPSK / rate 3/4 | 1/16 N = 32 | lab-only |
| `0x41` | `W2` | wired higher order | 16-QAM / provisional code | at most 1/16 N | unassigned waveform; disabled |

Only C0 and R1 may be assumed by baseline protocol code. A2 becomes selectable only after its FEC,
phase, SRO, and physical gates pass. R2/A3, X1, W1/W2, 16-QAM, WAV transfer tooling, Bluetooth, and
other stretch modes are not release features merely because IDs or UI experiments exist.

“Near-ultrasonic” never means inaudible. X1 requires warnings and measured bidirectional response,
intermodulation, and multi-device evidence. Wired results do not support over-air claims.

## 4. Burst waveform

All enabled OFDM profiles use the following initial structure:

```text
silence/turn guard determined by protocol state
→ 5–10 ms raised-cosine onset ramp
→ two short acquisition symbols
→ two long BPSK training symbols with profile CP
→ robust header copy A
→ robust header copy B
→ 8–320 payload OFDM symbols (bounded by frame bytes and 4 s)
→ 5–10 ms raised-cosine/WOLA release ramp
```

The short acquisition symbol has two identical `N/2` time halves and a deterministic PN sign
pattern. Repetition supplies a coarse timing metric and CFO estimate. The two long symbols use a
fixed PN BPSK value on every usable C0/R1 bin; the second uses a different fixed sequence. They
supply fine timing, channel estimation, noise/null estimates, and ambiguity rejection.

Header copies always use C0 carriers, BPSK, rate-1/2 FEC, the fixed whitening/interleaver rules in
`PROTOCOL.md`, and C0 CP, even when the payload changes profile. A receiver does not allocate or
decode a variable body until the header copies meet the protocol rule. Control frames encode their
body using C0 as well and are physically repeated according to the negotiated control repetition.

The initial two-short/two-long preamble, two header copies, CP values, 8–320 payload-symbol range,
and 4-second frame ceiling are testable starting bounds. False-alarm/miss distributions, room delay
spread, reverse-link overhead, and mobile CPU may require disabling a profile or assigning a new
one; they are not claimed as measured finals.

QPSK uses Gray mapping:

```text
00 -> (+1,+1)/sqrt(2)    01 -> (-1,+1)/sqrt(2)
11 -> (-1,-1)/sqrt(2)    10 -> (+1,-1)/sqrt(2)
```

BPSK maps `0 -> +1`, `1 -> -1`. Pilots use the profile's deterministic PN signs and never carry
payload. W2 has no accepted 16-QAM mapping until its separate contract and vectors exist.

## 5. Acquisition and receiver chain

The receiver is a burst receiver; it never assumes continuous sample alignment.

1. **Energy/noise gate:** maintain a bounded robust noise estimate from null bins and idle samples;
   do not start large decode work for every loud event.
2. **Short-symbol correlation:** search the two 44.1/48 kHz grid hypotheses, detect repeated halves,
   estimate coarse start and CFO, and rate-limit candidate decoders.
3. **Long-symbol correlation:** choose the grid, refine timing/CFO, reject sequence mismatch, and
   establish a burst identity candidate.
4. **Channel estimate:** divide known long-training carriers by received carriers, smooth only within
   bounded neighboring bins, and retain noise/null power.
5. **Equalization:** one-tap regularized zero-forcing/MMSE-style equalization with a documented noise
   floor; deep-null carriers become erasures rather than enormous gains.
6. **Pilot tracking:** per symbol, estimate common phase error. Fit phase slope across pilots for
   residual sample timing/SRO and update the bounded resampler slowly.
7. **Soft demapping:** produce signed, clipped log-likelihood metrics normalized by channel/noise
   confidence. Erasures have zero confidence.
8. **Deinterleave and soft Viterbi:** apply the exact protocol permutation/code; reject invalid tail,
   length, CRC, or confidence states.
9. **Frame validation:** pass decoded bytes through the allocation-first parser order in
   `PROTOCOL.md`; a discontinuity, overrun, or underflow forces reacquisition.

Coarse CFO comes from repeated-half phase. Fine CFO comes from long-training phase difference.
Residual common phase and phase slope come from pilots. SRO is not “fixed” by periodically dropping
samples without accounting; a fractional-delay resampler maintains a phase accumulator and reports
its ratio/limits. Initial simulation range is ±300 ppm and the hard acquisition/reacquisition bound
is ±1000 ppm. These are test ranges, not measured device limits.

Input/output devices may be independently clocked even when both contexts report 48 kHz. The
receiver therefore reports grid rate, context rate, resampler ratio, estimated residual ppm, phase
error, and sample discontinuities separately.

## 6. FEC, interleaving, and maintainability

The selected baseline is the classic K=7 rate-1/2 convolutional code with octal generators 171/133,
six zero tail bits, and a 64-state soft-decision Viterbi decoder. The exact encoder bit order,
puncture masks, interleaver, and CRC placement are in `PROTOCOL.md`.

Initial decoder design:

- signed/saturating 8-bit input likelihoods;
- 16- or 32-bit path metrics with explicit renormalization before overflow;
- full-frame bounded traceback ending in state zero;
- no survivor allocation based on unchecked wire dimensions;
- invalid termination, impossible length, or CRC mismatch is decode failure—not best-effort bytes.

Rate 2/3 and 3/4 puncturing is disabled until known-answer and beyond-capability tests pass. There is
no default Reed–Solomon, LDPC, Turbo, or repetition-only payload code. Selective-repeat ARQ,
interleaving, and convolutional FEC cover distinct errors without another large dependency. An outer
code needs measured burst-loss evidence and a new architecture decision.

The implementation is owned, small JavaScript rather than copied modem code or a native/WASM blob.
The algorithm choice is widely documented, but implementation provenance still records every
reference used. With no top-level repository license, any copied implementation or table remains
blocked on scoped compatibility and attribution review.

Independent known-answer evidence must include:

- all-zero, single-one, alternating, and randomized encoder streams;
- exact six-bit termination and final state;
- rate-1/2 clean decode and injected hard/soft errors;
- puncture/depuncture vectors before a punctured ID is enabled;
- truncation and errors beyond decoder capability that fail CRC;
- interleaver permutation/inversion independent of product code;
- cross-check fingerprints from a separately implemented reference with recorded provenance.

Product encoder/decoder round trips are necessary but insufficient.

## 7. Output shaping, clipping, and user safety

OFDM PAPR and consumer audio gain make digital full scale unsafe and distortion-prone. Initial
digital limits are:

- calibration begins at RMS `0.04` (about -28 dBFS) and never raises level without visible user
  confirmation;
- normal modem target RMS is at most `0.08` (about -22 dBFS);
- absolute generated peak is at most `0.50` (-6 dBFS) after scaling;
- onset/release ramps are at least 5 ms, with WOLA/raised-cosine overlap at symbol edges;
- a generated block that would exceed the peak is scaled, not hard-clipped;
- remote input peak, samples above 0.98, crest factor, and saturation runs are reported; observed
  clipping requests at least a 3 dB reduction and recalibration.

These are digital headroom limits, not acoustic SPL guarantees. The browser cannot know amplifier,
speaker, headphone, distance, or user volume. The UI warns before tones, starts low, offers a
persistent Stop control, never auto-maximizes system volume, and does not call any level “safe” in
physical units without calibrated hardware evidence. Headphones/Bluetooth are unsupported until
measured because latency, codecs, filtering, and route asymmetry can invalidate assumptions.

## 8. Bounded processing and metrics

Worklet duties and pools are defined in `ARCHITECTURE.md`. DSP runs in one Worker with preallocated
FFT tables, carrier maps, survivor storage, resampler buffers, and output blocks. Reconfiguration
occurs only between bursts. No per-symbol object graph, array growth, unbounded candidate queue, or
console logging is allowed.

Initial feasibility budgets:

- zero worklet buffer overflows/underflows in a 10-minute 48 kHz run;
- callback p99 below 20% of the observed render-quantum duration;
- Worker processes at least 2× real time in isolated benchmark and stays below 50% average of one
  core in the declared normal profile;
- no main-thread task over 50 ms caused by modem work;
- bounded queue depth and the 48 MiB controlled allocation ceiling;
- 15–30 minute Android thermal run before declaring a mobile profile usable.

These are go/no-go thresholds, not current results. Worklet-side FFT/FEC and unbounded buffering are
not fallback responses to a miss.

Live metrics distinguish direct observation from estimate:

| Metric | Meaning |
|---|---|
| CRC frame failures | decoded candidate frames rejected by CRC; not BER |
| EVM | pilot/data decision error after equalization; estimator and window recorded |
| SNR estimate | signal/noise-bin estimate, explicitly labeled estimate |
| CFO/SRO | estimator outputs with grid/context rates and confidence |
| underrun/overrun/discontinuity | direct counters from runtime |
| unique durable bytes | newly committed DATA bytes only |
| retransmitted bytes | DATA payload sent again; never counted as unique |
| clipping | direct sample threshold counts, not acoustic distortion measurement |

BER is reported only in simulation/fixtures with known transmitted bits.

## 9. Deterministic channel model

The simulator is a test instrument, never a production transport fallback. Configuration, PRNG
algorithm/version, seed, fixture hash, impairment order, and output hash are archived with results.

PRNG v1 is `xorshift32` with nonzero `u32` state:

```text
x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state = x >>> 0
u = state / 2^32
```

A zero requested seed maps to `0x6D2B79F5`. Approximate unit-variance Gaussian noise uses the sum of
12 independent `u` values minus 6, avoiding hidden nondeterministic randomness. The exact sequence
has independent fingerprints before channel acceptance.

Fractional delay/resampling kernel v1 has 17 taps indexed `j=-8..8`:

```text
sinc(x) = 1 when x=0, otherwise sin(pi*x)/(pi*x)
w(j) = 0.42 + 0.5*cos(pi*j/8) + 0.08*cos(2*pi*j/8)
h(j,f) = sinc(j-f)*w(j), normalized so sum(h)=1, 0<=f<1
```

The analytic-signal CFO model uses a 63-tap Type-III Hilbert FIR indexed `j=-31..31`: zero for even
`j` (including zero), `2/(pi*j)` for odd `j`, multiplied by the analogous centered Blackman window
with denominator 31. The delayed real input and Hilbert output form the analytic pair, which is
rotated by `exp(i*2*pi*cfoHz*n/Fs)` before taking the real part. Tests pin an impulse vector and a
quantized fingerprint so normal cross-engine floating-point tolerance cannot become an unbounded
comparison. The same 17-tap kernel and explicit phase accumulator implement SRO.

Channel operations occur in this recorded order:

1. static gain and deterministic frequency-response FIR;
2. integer/fractional multipath FIR (fractional taps use the fixed windowed-sinc kernel version);
3. nominal grid/context and time-varying SRO resampling;
4. analytic-signal carrier-frequency shift using the pinned Hilbert FIR version;
5. time-varying AGC envelope/gain steps;
6. soft or hard clipping/nonlinear compression;
7. colored noise, narrow tones, and seeded impulses/bursts;
8. whole-block drops/repeats and declared silence insertions;
9. quantization.

Every versioned kernel has a golden impulse/output vector. Measured room responses are separate
assets with provenance and held-out splits; synthetic and measured channels are never conflated.

### Initial benchmark matrix

Run the exact 1 MiB deterministic fixture under seeds `0xA11CE001` through `0xA11CE004` for each
row. Values are proposed test inputs, not descriptions of real rooms/devices.

| Condition | Proposed impairments |
|---|---|
| `CLEAN` | unity gain, high SNR, 16-bit quantization; no drift/drop |
| `ROOM18` | 18 dB SNR; taps at 0, 1.7, 5.9 ms with 0/-7/-12 dB; ripple/roll-off; +80 ppm SRO; +2 Hz CFO |
| `DEVICE12` | 12 dB SNR; narrow tone; -180 ppm SRO; -6 Hz CFO; soft clip 0.75; ±6 dB/0.8 s AGC; sparse impulses |
| `BURST15` | 15 dB SNR; multipath; +250 ppm SRO; 0.2% dropped blocks; seeded 20–40 ms bursts/erasures |

R1's proposed simulator gate is exact final SHA-256 under every row/seed, no retry exhaustion, and
at least 1 kbps data-phase verified goodput. A2's proposed gate is exact completion for CLEAN and
ROOM18 with at least 5 kbps. These values are investigation thresholds; passing them proves only
deterministic simulation. A3/X1/W1/W2 remain exploratory.

Development/tuning channels and held-out acceptance channels are disjoint. A single lucky seed or a
channel tuned against itself does not pass.

## 10. Throughput and evidence accounting

Every benchmark reports all of:

- **constellation raw bit rate:** data carriers × modulation bits / OFDM-symbol time, before FEC;
- **coded information rate:** information bits after FEC/puncture, before headers/CRC/preamble;
- **wire payload rate:** DATA chunk bytes divided by DATA waveform duration, before loss/retry;
- **unique durable rate:** newly transaction-committed chunk bytes divided by elapsed data phase;
- **data-phase verified goodput:** exact file bytes divided by time from first DATA sample through
  decoded FINAL_ACK, including preambles, CP, guards, turns, ringing, ACKs, retransmission,
  reacquisition, and final hash;
- **session verified goodput:** exact file bytes divided by time from first HELLO sample through
  decoded FINAL_ACK, additionally including negotiation/calibration/manifest;
- separate CPU, heap high-water, underruns, FER, ACK loss, retry, CFO/SRO, clipping, and hash time.

If final SHA-256 fails or FINAL_ACK is not decoded, completed-file goodput is zero. Headline rate may
not be raw PHY or accepted frame bytes mislabeled as file throughput.

Evidence labels are mandatory and mutually explicit:

1. deterministic simulation;
2. digital in-memory loopback;
3. digital WAV export/import;
4. wired audio connection;
5. same-device acoustic loopback;
6. two-device over-air.

Only category 6 supports over-air compatibility, reliability, distance, environmental, turnaround,
or goodput claims. PWA install, mock media, prerecorded WAV, simulator, and cable success cannot
prove acoustic interoperability.

## 11. Mandatory DSP stop/go evidence

Parameter lock requires:

- C0 discovery and reverse ACK delivery distributions through real transducers;
- held-out acquisition false-alarm/miss results at both grid rates;
- exact R1 and A2 carrier/preamble/training vectors;
- ±300 ppm seeded tracking and a 10-minute physical drift run without slips/hash failure;
- measured room tails to justify CP and 100–1500 ms turnaround guard bounds;
- effective EC/NS/AGC reports plus decode behavior when controls cannot be disabled;
- clipping/PAPR and digital-level evidence without physical “safe volume” claims;
- independent K7/interleaver/CRC vectors and beyond-capability failures;
- Worker/worklet/mobile thermal budgets;
- separately labeled simulator, digital, cable, same-device, and two-device results.

Failure disables or revises the affected profile through a reviewed contract update. It never
converts an unmeasured value into a release default.
