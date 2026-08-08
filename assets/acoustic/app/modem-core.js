"use strict";
/*
 * Production acoustic modem primitives, selectively adapted from the reviewed
 * Local Suite acoustic lane: CRC32C, bounded wire parsing, K=7 rate-1/2 FEC,
 * FFT/preamble/profile planning, and audible OFDM burst encode/decode.
 * This deliberately excludes the lane's session, resume, storage, ARQ,
 * benchmark, simulator, and mutable lifecycle layers.
 */

/* adapted: constants.js */
(function (root) {
  "use strict";

  const namespace = root.AcousticV1 || (root.AcousticV1 = Object.create(null));
  if (namespace.Constants) throw new Error("AcousticV1.Constants already defined");

  const FRAME_TYPES = Object.freeze({
    HELLO: 0x01, ACCEPT: 0x02, TRAIN: 0x03, CAL_REPORT: 0x04,
    MANIFEST: 0x05, MANIFEST_ACK: 0x06, DATA: 0x10, TURN: 0x11,
    ACK: 0x12, PROFILE: 0x13, PAUSE: 0x14, RESUME_QUERY: 0x15,
    RESUME_STATE: 0x16, FIN: 0x17, FINAL_ACK: 0x18,
    FINAL_CONFIRM: 0x19, CANCEL: 0x1a, ERROR: 0x1b,
  });
  const TYPE_NAMES = Object.freeze(Object.fromEntries(Object.entries(FRAME_TYPES).map(([name, id]) => [id, name])));
  const FLAGS = Object.freeze({
    FROM_RECEIVER: 0x01, RETRANSMIT: 0x02, MORE: 0x04, RESUME: 0x08,
    FINAL: 0x10, ENCRYPTED: 0x20,
  });
  const TLV_TYPES = Object.freeze({
    VERSION_RANGE: 0x01, PROFILE_LIST: 0x02, FEC_LIST: 0x03,
    GRID_RATES: 0x04, FILE_LIMIT: 0x05, CHUNK_RANGE: 0x06,
    WINDOW_RANGE: 0x07, BURST_LIMITS: 0x08, AUDIO_PROCESSING: 0x09,
    ENDPOINT_NONCE: 0x0a, MANIFEST_ID: 0x0b, TURN_PARAMS: 0x0c,
    ERROR_DETAIL: 0x0d,
  });
  const ERROR_CODES = Object.freeze({
    BAD_VERSION: 0x0001, BAD_FRAME: 0x0002, BAD_CRC: 0x0003,
    BAD_RESERVED: 0x0004, INCOMPATIBLE_CAPABILITY: 0x0005,
    INCOMPATIBLE_FEATURE: 0x0006, LIMIT_FILE: 0x0007,
    LIMIT_RESOURCE: 0x0008, MANIFEST_MISMATCH: 0x0009,
    SESSION_MISMATCH: 0x000a, CHUNK_CONFLICT: 0x000b,
    STORAGE_FAILURE: 0x000c, HASH_MISMATCH: 0x000d,
    LINK_UNUSABLE: 0x000e, CANCELLED: 0x000f,
    RUNTIME_UNSUPPORTED: 0x0010,
  });
  const PROFILES = Object.freeze({ C0: 0x01, R1: 0x10 });
  const FECS = Object.freeze({ K7_R12: 0x01, K7_R23: 0x02, K7_R34: 0x03 });
  const LIMITS = Object.freeze({
    protocolMajor: 1, protocolMinor: 1, headerBytes: 56, trailerBytes: 4,
    maxFramePayloadBytes: 4096, maxFrameBytes: 4156,
    maxControlPayloadBytes: 192, maxTlvs: 32, maxManifestBytes: 1024,
    minFileBytes: 1, maxFileBytes: 1024 * 1024,
    parserFileCeiling: 1024 * 1024, minChunkBytes: 256,
    maxChunkBytes: 2048, maxChunks: 65536, minWindow: 8, maxWindow: 128,
    ackBitmapBits: 128, ackBitmapBytes: 16, maxAckRanges: 8,
    maxDataRetries: 8, maxControlAttempts: 10, maxBurstFrames: 16,
    minBurstMs: 500, maxBurstMs: 8000, minAckTimeoutMs: 1000,
    maxAckTimeoutMs: 10000, maxPhysicalFrameSeconds: 4,
    maxPayloadSymbols: 320, minPayloadSymbols: 8, fftSize: 512,
    maxCandidates: 4, maxCandidateOffsets: 8193, maxPcmBlockSamples: 4096,
    maxWorkerQueue: 16, maxLogRecords: 2000, maxLogBytes: 1024 * 1024,
    maxShaBytes: 1024 * 1024,
  });
  const CONTROL_TYPES = Object.freeze([
    FRAME_TYPES.HELLO, FRAME_TYPES.ACCEPT, FRAME_TYPES.TRAIN,
    FRAME_TYPES.CAL_REPORT, FRAME_TYPES.MANIFEST, FRAME_TYPES.MANIFEST_ACK,
    FRAME_TYPES.TURN, FRAME_TYPES.ACK, FRAME_TYPES.PROFILE, FRAME_TYPES.PAUSE,
    FRAME_TYPES.RESUME_QUERY, FRAME_TYPES.RESUME_STATE, FRAME_TYPES.FIN,
    FRAME_TYPES.FINAL_ACK, FRAME_TYPES.FINAL_CONFIRM, FRAME_TYPES.CANCEL,
    FRAME_TYPES.ERROR,
  ]);
  const RECEIVER_TYPES = Object.freeze([
    FRAME_TYPES.ACCEPT, FRAME_TYPES.CAL_REPORT, FRAME_TYPES.MANIFEST_ACK,
    FRAME_TYPES.ACK, FRAME_TYPES.RESUME_STATE, FRAME_TYPES.FINAL_ACK,
  ]);
  const SENDER_TYPES = Object.freeze([
    FRAME_TYPES.HELLO, FRAME_TYPES.MANIFEST, FRAME_TYPES.DATA, FRAME_TYPES.TURN,
    FRAME_TYPES.RESUME_QUERY, FRAME_TYPES.FIN, FRAME_TYPES.FINAL_CONFIRM,
  ]);
  const MAGIC_FRAME = Object.freeze([0x41, 0x4d, 0x31, 0x46]);
  const MAGIC_MANIFEST = Object.freeze([0x41, 0x4d, 0x31, 0x4d]);

  namespace.Constants = Object.freeze({
    API_VERSION: 1, FRAME_TYPES, TYPE_NAMES, FLAGS, TLV_TYPES, ERROR_CODES,
    PROFILES, FECS, LIMITS, CONTROL_TYPES, RECEIVER_TYPES, SENDER_TYPES,
    MAGIC_FRAME, MAGIC_MANIFEST, HEADER_WHITENING_SEED: 0x4d3b,
    HEADER_INTERLEAVER_SEED: 0xa31c5eed,
  });
}(globalThis));


/* adapted: bytes.js */
(function (root) {
  "use strict";
  const A = root.AcousticV1;
  if (!A || !A.Constants) throw new Error("AcousticV1.Constants required");
  if (A.Bytes) throw new Error("AcousticV1.Bytes already defined");

  const ok = value => ({ ok: true, value });
  const fail = (code, detail) => ({ ok: false, code, detail: String(detail || "").slice(0, 192) });
  const isBytes = value => value instanceof Uint8Array;
  function range(bytes, offset, width) {
    return isBytes(bytes) && Number.isSafeInteger(offset) && offset >= 0 &&
      Number.isSafeInteger(width) && width >= 0 && offset <= bytes.length - width;
  }
  function readU8(bytes, offset) { return range(bytes, offset, 1) ? ok(bytes[offset]) : fail("BOUNDS", "u8 read"); }
  function readU16(bytes, offset) { return range(bytes, offset, 2) ? ok((bytes[offset] << 8) | bytes[offset + 1]) : fail("BOUNDS", "u16 read"); }
  function readU32(bytes, offset) {
    if (!range(bytes, offset, 4)) return fail("BOUNDS", "u32 read");
    return ok((((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0));
  }
  function readU64(bytes, offset) {
    if (!range(bytes, offset, 8)) return fail("BOUNDS", "u64 read");
    const hi = readU32(bytes, offset).value;
    const lo = readU32(bytes, offset + 4).value;
    return ok((BigInt(hi) << 32n) | BigInt(lo));
  }
  function writeU8(bytes, offset, value) {
    if (!range(bytes, offset, 1) || !Number.isInteger(value) || value < 0 || value > 0xff) return fail("BOUNDS", "u8 write");
    bytes[offset] = value; return ok(bytes);
  }
  function writeU16(bytes, offset, value) {
    if (!range(bytes, offset, 2) || !Number.isInteger(value) || value < 0 || value > 0xffff) return fail("BOUNDS", "u16 write");
    bytes[offset] = value >>> 8; bytes[offset + 1] = value; return ok(bytes);
  }
  function writeU32(bytes, offset, value) {
    if (!range(bytes, offset, 4) || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return fail("BOUNDS", "u32 write");
    bytes[offset] = value >>> 24; bytes[offset + 1] = value >>> 16;
    bytes[offset + 2] = value >>> 8; bytes[offset + 3] = value; return ok(bytes);
  }
  function writeU64(bytes, offset, value) {
    if (!range(bytes, offset, 8) || typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) return fail("BOUNDS", "u64 write");
    writeU32(bytes, offset, Number((value >> 32n) & 0xffffffffn));
    writeU32(bytes, offset + 4, Number(value & 0xffffffffn)); return ok(bytes);
  }
  function equal(a, b) {
    if (!isBytes(a) || !isBytes(b) || a.length !== b.length) return false;
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  function hex(bytes) {
    if (!isBytes(bytes)) return fail("TYPE", "hex input");
    let out = ""; for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return ok(out);
  }
  function fromHex(text, maxBytes = A.Constants.LIMITS.maxFrameBytes) {
    if (typeof text !== "string" || text.length % 2 || text.length > maxBytes * 2 || !/^[0-9a-f]*$/i.test(text)) return fail("BAD_HEX", "invalid bounded hex");
    const out = new Uint8Array(text.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
    return ok(out);
  }
  function checkedAdd(a, b, ceiling = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a > ceiling - b) return fail("OVERFLOW", "addition");
    return ok(a + b);
  }
  function checkedMultiply(a, b, ceiling = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || (b !== 0 && a > Math.floor(ceiling / b))) return fail("OVERFLOW", "multiplication");
    return ok(a * b);
  }

  A.Bytes = Object.freeze({ ok, fail, isBytes, range, readU8, readU16, readU32, readU64, writeU8, writeU16, writeU32, writeU64, equal, hex, fromHex, checkedAdd, checkedMultiply });
}(globalThis));


/* adapted: crc32c.js */
(function (root) {
  "use strict";
  const A = root.AcousticV1;
  if (!A || !A.Bytes) throw new Error("AcousticV1.Bytes required");
  if (A.Crc32c) throw new Error("AcousticV1.Crc32c already defined");
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0x82f63b78 : 0);
    table[i] = value >>> 0;
  }
  function update(register, bytes) {
    if (!Number.isInteger(register) || register < 0 || register > 0xffffffff || !A.Bytes.isBytes(bytes)) return A.Bytes.fail("TYPE", "CRC32C input");
    let crc = register >>> 0;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return A.Bytes.ok(crc >>> 0);
  }
  function digest(bytes, seed) {
    const initial = seed === undefined ? 0xffffffff : ((seed ^ 0xffffffff) >>> 0);
    const result = update(initial, bytes);
    return result.ok ? ((result.value ^ 0xffffffff) >>> 0) : result;
  }
  A.Crc32c = Object.freeze({ digest, update, table: () => table.slice() });
}(globalThis));


/* adapted: fft.js */
(function(root){
  "use strict";
  const A=root.AcousticV1,ok=A.Bytes.ok,fail=A.Bytes.fail;
  if(!A||!A.Bytes)throw new Error("AcousticV1.Bytes required");if(A.Fft)throw new Error("AcousticV1.Fft already defined");
  const powerOfTwo=value=>Number.isInteger(value)&&value>0&&(value&(value-1))===0;
  function validate(re,im){if(!(re instanceof Float64Array)||!(im instanceof Float64Array)||re.length!==im.length||!powerOfTwo(re.length)||re.length>2048)return fail("BAD_FFT","dimensions");for(let i=0;i<re.length;i++)if(!Number.isFinite(re[i])||!Number.isFinite(im[i]))return fail("BAD_FFT","non-finite input");return ok(true);}
  function transform(re,im,inverse=false){const checked=validate(re,im);if(!checked.ok||typeof inverse!=="boolean")return checked.ok?fail("BAD_FFT","direction"):checked;const n=re.length;
    for(let i=1,j=0;i<n;i++){let bit=n>>>1;for(;j&bit;bit>>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let length=2;length<=n;length<<=1){const angle=(inverse?2:-2)*Math.PI/length,stepRe=Math.cos(angle),stepIm=Math.sin(angle);for(let base=0;base<n;base+=length){let wr=1,wi=0;for(let j=0;j<length/2;j++){const even=base+j,odd=even+length/2,vr=re[odd]*wr-im[odd]*wi,vi=re[odd]*wi+im[odd]*wr,ur=re[even],ui=im[even];re[even]=ur+vr;im[even]=ui+vi;re[odd]=ur-vr;im[odd]=ui-vi;const next=wr*stepRe-wi*stepIm;wi=wr*stepIm+wi*stepRe;wr=next;}}}
    if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}return ok({re,im});
  }
  function forwardReal(samples){if(!(samples instanceof Float32Array||samples instanceof Float64Array)||!powerOfTwo(samples.length)||samples.length>2048)return fail("BAD_FFT","real dimensions");for(const value of samples)if(!Number.isFinite(value))return fail("BAD_FFT","real sample");const re=Float64Array.from(samples),im=new Float64Array(samples.length);return transform(re,im,false);}
  function inverseReal(reInput,imInput){if(!(reInput instanceof Float32Array||reInput instanceof Float64Array)||!(imInput instanceof Float32Array||imInput instanceof Float64Array)||reInput.length!==imInput.length||!powerOfTwo(reInput.length)||reInput.length>2048)return fail("BAD_FFT","inverse dimensions");for(let i=0;i<reInput.length;i++)if(!Number.isFinite(reInput[i])||!Number.isFinite(imInput[i]))return fail("BAD_FFT","inverse sample");const re=Float64Array.from(reInput),im=Float64Array.from(imInput),done=transform(re,im,true);return done.ok?ok(Float32Array.from(re)):done;}
  A.Fft=Object.freeze({powerOfTwo,transform,forwardReal,inverseReal});
}(globalThis));


/* adapted: profiles.js */
(function(root){
  "use strict";
  const A=root.AcousticV1,C=A.Constants,ok=A.Bytes.ok,fail=A.Bytes.fail;
  if(!A||!A.Fft)throw new Error("AcousticV1.Fft required");if(A.Profiles)throw new Error("AcousticV1.Profiles already defined");
  const registry=Object.freeze({
    1:Object.freeze({id:1,name:"C0",fLo:1500,fHi:5500,modulation:"BPSK",fecId:C.FECS.K7_R12,cp:128,enabled:true}),
    16:Object.freeze({id:16,name:"R1",fLo:1500,fHi:6500,modulation:"BPSK",fecId:C.FECS.K7_R12,cp:128,enabled:true}),
  });
  function plan(profileId,sampleRate){const id=typeof profileId==="string"?C.PROFILES[profileId]:profileId,profile=registry[id];if(!profile||!profile.enabled)return fail("BAD_PROFILE","disabled or unknown");if(sampleRate!==44100&&sampleRate!==48000)return fail("BAD_SAMPLE_RATE","grid must be 44100 or 48000");const n=512,deltaF=sampleRate/n,kLo=Math.ceil(profile.fLo/deltaF),kHi=Math.floor(Math.min(profile.fHi,.45*sampleRate)/deltaF),usable=[];for(let bin=kLo+2;bin<=kHi-2;bin++)usable.push(bin);const pilots=usable.filter((_,i)=>i%8===0),pilotSet=new Set(pilots),data=usable.filter(bin=>!pilotSet.has(bin)),symbolSamples=n+profile.cp,bitsPerCarrier=profile.modulation==="QPSK"?2:1;return ok(Object.freeze({...profile,sampleRate,n,deltaF,kLo,kHi,usable:Object.freeze(usable),pilots:Object.freeze(pilots),data:Object.freeze(data),bitsPerCarrier,symbolSamples,symbolSeconds:symbolSamples/sampleRate,rawBitRate:data.length*bitsPerCarrier/(symbolSamples/sampleRate),codedInformationRate:data.length*bitsPerCarrier/2/(symbolSamples/sampleRate)}));}
  function vectors(){const out=[];for(const rate of [44100,48000])for(const id of [1,16])out.push(plan(id,rate).value);return Object.freeze(out);}
  A.Profiles=Object.freeze({plan,vectors,registry});
}(globalThis));


/* adapted: preamble.js */
(function(root){
  "use strict";
  const A=root.AcousticV1,ok=A.Bytes.ok,fail=A.Bytes.fail;
  if(!A||!A.Profiles)throw new Error("AcousticV1.Profiles required");if(A.Preamble)throw new Error("AcousticV1.Preamble already defined");
  function sign(domain,sequence,bin){let x=(Math.imul((domain^bin)>>>0,0x45d9f3b)^Math.imul((sequence+1)>>>0,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;return(x&1)?-1:1;}
  function hermitian(plan,positive){const re=new Float64Array(plan.n),im=new Float64Array(plan.n);for(const entry of positive){const bin=entry[0],real=entry[1],imaginary=entry.length>2?entry[2]:0;if(!Number.isInteger(bin)||bin<=0||bin>=plan.n/2||!Number.isFinite(real)||!Number.isFinite(imaginary)||Math.hypot(real,imaginary)>1.000001)return fail("BAD_OFDM","frequency value");re[bin]=real;im[bin]=imaginary;}for(let bin=1;bin<plan.n/2;bin++){re[plan.n-bin]=re[bin];im[plan.n-bin]=-im[bin];}return ok({re,im});}
  function short(plan){if(!plan||plan.n!==512)return fail("BAD_PROFILE","short preamble plan");const values=[];for(const bin of plan.usable)if((bin&1)===0)values.push([bin,sign(0x41435131,0,bin)]);const frequency=hermitian(plan,values);return frequency.ok?A.Fft.inverseReal(frequency.value.re,frequency.value.im):frequency;}
  function training(plan,index){if(index!==1&&index!==2)return fail("BAD_OFDM","training index");const domain=index===1?0x54524e31:0x54524e32,values=plan.usable.map(bin=>[bin,sign(domain,index,bin)]),frequency=hermitian(plan,values);return frequency.ok?A.Fft.inverseReal(frequency.value.re,frequency.value.im):frequency;}
  function pilot(plan,sequence,bin){return plan.pilots.includes(bin)?ok(sign(0x50494c4f,sequence,bin)):fail("BAD_OFDM","not a pilot");}
  A.Preamble=Object.freeze({sign,hermitian,short,training,pilot});
}(globalThis));


/* adapted: resampler.js */
(function(root){
  "use strict";
  const A=root.AcousticV1,ok=A.Bytes.ok,fail=A.Bytes.fail;
  if(!A||!A.Bytes)throw new Error("AcousticV1.Bytes required");if(A.Resampler)throw new Error("AcousticV1.Resampler already defined");
  const phases=1024,taps=17,center=8,sinc=x=>Math.abs(x)<1e-14?1:Math.sin(Math.PI*x)/(Math.PI*x),kernels=new Float64Array(phases*taps);
  for(let phase=0;phase<phases;phase++){const fraction=phase/phases;let sum=0;for(let j=-center;j<=center;j++){const window=.42+.5*Math.cos(Math.PI*j/center)+.08*Math.cos(2*Math.PI*j/center),value=sinc(j-fraction)*window;kernels[phase*taps+j+center]=value;sum+=value;}for(let j=0;j<taps;j++)kernels[phase*taps+j]/=sum;}
  function unchecked(input,position){const integer=Math.floor(position),fraction=position-integer,phase=Math.min(phases-1,Math.floor(fraction*phases));let value=0;for(let tap=0;tap<taps;tap++){const index=integer+tap-center;if(index>=0&&index<input.length)value+=input[index]*kernels[phase*taps+tap];}return value;}
  function sample(input,position){if(!(input instanceof Float32Array||input instanceof Float64Array)||!Number.isFinite(position)||position<0||position>input.length-1)return fail("BAD_RESAMPLER","input/position");const value=unchecked(input,position);return Number.isFinite(value)?ok(value):fail("BAD_RESAMPLER","non-finite output");}
  class Tracker{
    constructor(config={}){const ppm=config.initialPpm||0;if(!Number.isFinite(ppm)||Math.abs(ppm)>1000)throw new RangeError("SRO ppm bound");this.ratio=1+ppm/1e6;this.phase=0;this.correction=0;this.updates=0;this.maxAbsCorrection=0;this.ceiling=64;}
    position(index){return index*this.ratio+this.phase;}
    update(residualSamples,gain=.1){if(!Number.isFinite(residualSamples)||Math.abs(residualSamples)>64||!Number.isFinite(gain)||gain<=0||gain>.25)return fail("BAD_RESAMPLER","timing observation");const change=Math.max(-.25,Math.min(.25,residualSamples*gain)),next=this.phase+change;if(Math.abs(next)>this.ceiling)return fail("DISCONTINUITY","timing correction ceiling");this.phase=next;this.correction+=change;this.updates++;this.maxAbsCorrection=Math.max(this.maxAbsCorrection,Math.abs(next));return ok(change);}
    setPpm(ppm){if(!Number.isFinite(ppm)||Math.abs(ppm)>1000)return fail("BAD_RESAMPLER","ppm");this.ratio=1+ppm/1e6;return ok(this.ratio);}
    metrics(){return Object.freeze({ratio:this.ratio,phaseSamples:this.phase,cumulativeCorrectionSamples:this.correction,updates:this.updates,maxAbsCorrectionSamples:this.maxAbsCorrection});}
  }
  A.Resampler=Object.freeze({sample,unchecked,Tracker,SPEC:Object.freeze({phases,taps,center,maxPpm:1000,correctionCeilingSamples:64})});
}(globalThis));


/* adapted: coding.js */
(function (root) {
  "use strict";
  const A = root.AcousticV1;
  if (!A || !A.Crc32c) throw new Error("AcousticV1.Crc32c required");
  if (A.Whitening || A.Fec || A.Interleave) throw new Error("Acoustic coding namespace already defined");
  const maxBits = (A.Constants.LIMITS.maxFrameBytes * 8) + 6;
  const validBits = bits => bits instanceof Uint8Array && bits.length <= maxBits && bits.every(bit => bit === 0 || bit === 1);
  function bytesToBits(bytes) {
    if (!A.Bytes.isBytes(bytes) || bytes.length > A.Constants.LIMITS.maxFrameBytes) return A.Bytes.fail("LIMIT_RESOURCE", "bit source");
    const bits = new Uint8Array(bytes.length * 8);
    for(let i=0;i<bytes.length;i++) for(let b=0;b<8;b++) bits[i*8+b]=(bytes[i] >>> (7-b)) & 1;
    return A.Bytes.ok(bits);
  }
  function bitsToBytes(bits) {
    if (!validBits(bits) || bits.length % 8) return A.Bytes.fail("BAD_LENGTH", "bits must be bounded and byte aligned");
    const bytes=new Uint8Array(bits.length/8);
    for(let i=0;i<bits.length;i++) bytes[i>>>3] |= bits[i] << (7-(i&7));
    return A.Bytes.ok(bytes);
  }
  function apply(bits, requestedSeed) {
    if (!validBits(bits) || !Number.isInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > 0x7fff) return A.Bytes.fail("BAD_WHITENING", "input or seed");
    const out=new Uint8Array(bits.length); let state=requestedSeed || 1;
    for(let i=0;i<bits.length;i++) { out[i]=bits[i]^(state&1); const feedback=((state>>>0)^(state>>>1))&1; state=(state>>>1)|(feedback<<14); }
    return A.Bytes.ok(out);
  }
  const parity = value => { value^=value>>>16;value^=value>>>8;value^=value>>>4;return(0x6996>>>(value&15))&1; };
  function encode(bits) {
    if (!validBits(bits) || bits.length > maxBits-6) return A.Bytes.fail("BAD_FEC", "encoder input");
    const out=new Uint8Array((bits.length+6)*2); let reg=0,at=0;
    for(let i=0;i<bits.length+6;i++){ const bit=i<bits.length?bits[i]:0; reg=((reg<<1)|bit)&0x7f; out[at++]=parity(reg&0x79);out[at++]=parity(reg&0x5b); }
    return A.Bytes.ok(out);
  }
  function hardToSoft(bits,magnitude=64){
    if(!validBits(bits)||!Number.isFinite(magnitude)||magnitude<=0||magnitude>127)return A.Bytes.fail("BAD_FEC","hard likelihood input");
    const out=new Int8Array(bits.length);for(let i=0;i<bits.length;i++)out[i]=bits[i]?-magnitude:magnitude;return A.Bytes.ok(out);
  }
  function decode(soft,informationBits){
    if(!(soft instanceof Int8Array||soft instanceof Float32Array||soft instanceof Float64Array)||!Number.isInteger(informationBits)||informationBits<0||informationBits>maxBits-6)return A.Bytes.fail("BAD_FEC","decoder dimensions");
    const steps=informationBits+6;if(soft.length!==steps*2)return A.Bytes.fail("BAD_LENGTH","likelihood count");
    for(let i=0;i<soft.length;i++)if(!Number.isFinite(soft[i])||Math.abs(soft[i])>127)return A.Bytes.fail("BAD_FEC","likelihood value");
    const allocation=A.Bytes.checkedMultiply(steps,64,3*1024*1024);if(!allocation.ok)return allocation;
    const priorChoice=new Uint8Array(allocation.value), bitChoice=new Uint8Array(allocation.value);
    let current=new Float64Array(64),next=new Float64Array(64);current.fill(Infinity);current[0]=0;
    for(let step=0;step<steps;step++){
      next.fill(Infinity);const l0=soft[step*2],l1=soft[step*2+1];
      for(let prior=0;prior<64;prior++)if(Number.isFinite(current[prior]))for(let bit=0;bit<2;bit++){
        const reg=((prior<<1)|bit)&0x7f,state=reg&0x3f,e0=parity(reg&0x79),e1=parity(reg&0x5b);
        const metric=current[prior]+(e0?l0:-l0)+(e1?l1:-l1); // positive soft favours zero
        const slot=step*64+state;
        if(metric<next[state]||(metric===next[state]&&(prior<priorChoice[slot]||(prior===priorChoice[slot]&&bit<bitChoice[slot])))){
          next[state]=metric;priorChoice[slot]=prior;bitChoice[slot]=bit;
        }
      }
      let min=Infinity;for(const value of next)if(value<min)min=value;if(!Number.isFinite(min))return A.Bytes.fail("DECODE_FAILED","no live Viterbi path");
      for(let state=0;state<64;state++)next[state]-=min;[current,next]=[next,current];
    }
    if(!Number.isFinite(current[0]))return A.Bytes.fail("DECODE_FAILED","terminal state");
    const decoded=new Uint8Array(steps);let state=0;
    for(let step=steps-1;step>=0;step--){const slot=step*64+state;decoded[step]=bitChoice[slot];state=priorChoice[slot];}
    if(state!==0)return A.Bytes.fail("DECODE_FAILED","traceback state");
    for(let i=informationBits;i<steps;i++)if(decoded[i]!==0)return A.Bytes.fail("DECODE_FAILED","nonzero tail");
    return A.Bytes.ok({bits:decoded.slice(0,informationBits),metric:current[0],tracebackBytes:priorChoice.byteLength+bitChoice.byteLength});
  }
  const gcd=(a,b)=>{while(b){const t=a%b;a=b;b=t;}return a;};
  function parameters(length,seed){
    if(!Number.isInteger(length)||length<0||length>maxBits*2||!Number.isInteger(seed)||seed<0||seed>0xffffffff)return A.Bytes.fail("BAD_INTERLEAVER","dimensions");
    if(length===0)return A.Bytes.ok({a:1,b:0});let a=(((seed>>>16)|1)>>>0)%length;if(a===0)a=1;const b=(seed>>>0)%length;
    for(let attempts=0;gcd(a,length)!==1;attempts++){if(attempts>=length)return A.Bytes.fail("BAD_INTERLEAVER","permutation");a=(a+2)%length;if(a===0)a=1;}
    return A.Bytes.ok({a,b});
  }
  function permute(values,seed,inverse){
    if(!(values instanceof Uint8Array||values instanceof Int8Array||values instanceof Float32Array||values instanceof Float64Array)||values.length>maxBits*2)return A.Bytes.fail("BAD_INTERLEAVER","array");
    const p=parameters(values.length,seed);if(!p.ok)return p;const out=new values.constructor(values.length);
    for(let i=0;i<values.length;i++){const at=values.length?(p.value.a*i+p.value.b)%values.length:0;if(inverse)out[i]=values[at];else out[at]=values[i];}
    return A.Bytes.ok(out);
  }
  function seedMaterial(sessionId,epoch,sequence,profileId,terminal){
    if(!A.Bytes.isBytes(sessionId)||sessionId.length!==16||!Number.isInteger(epoch)||epoch<0||epoch>0xffff||!Number.isInteger(sequence)||sequence<0||sequence>0xffffffff||!Number.isInteger(profileId)||profileId<0||profileId>0xff)return A.Bytes.fail("BAD_SEED_MATERIAL","fields");
    const bytes=new Uint8Array(24);bytes.set(sessionId);A.Bytes.writeU16(bytes,16,epoch);A.Bytes.writeU32(bytes,18,sequence);bytes[22]=profileId;bytes[23]=terminal;
    return A.Bytes.ok(A.Crc32c.digest(bytes));
  }
  A.Whitening=Object.freeze({apply,bytesToBits,bitsToBytes,deriveSeed:(s,e,q,p)=>{const r=seedMaterial(s,e,q,p,0x57);return r.ok?A.Bytes.ok((r.value&0x7fff)||1):r;}});
  A.Fec=Object.freeze({encode,decode,hardToSoft,parity});
  A.Interleave=Object.freeze({parameters,interleave:(v,s)=>permute(v,s,false),deinterleave:(v,s)=>permute(v,s,true),deriveSeed:(s,e,q,p)=>seedMaterial(s,e,q,p,0x49)});
}(globalThis));


/* adapted: wire.js */
(function (root) {
  "use strict";
  const A=root.AcousticV1,C=A.Constants,L=C.LIMITS,T=C.FRAME_TYPES,F=C.FLAGS;
  if(!A||!A.Interleave)throw new Error("Acoustic coding modules required");
  if(A.Wire)throw new Error("AcousticV1.Wire already defined");
  const fail=A.Bytes.fail,ok=A.Bytes.ok;
  const tlvTypes=new Set(Object.values(C.TLV_TYPES));
  const tlvFrames=new Set([T.HELLO,T.ACCEPT,T.TRAIN,T.CAL_REPORT,T.PROFILE,T.PAUSE,T.CANCEL,T.ERROR]);
  const payloadCeiling=Object.freeze({[T.MANIFEST]:512,[T.MANIFEST_ACK]:40,[T.DATA]:2060,[T.TURN]:32,[T.ACK]:96,[T.RESUME_QUERY]:1058,[T.RESUME_STATE]:128,[T.FIN]:80,[T.FINAL_ACK]:80,[T.FINAL_CONFIRM]:80});
  const sameMagic=(bytes,magic)=>magic.every((value,index)=>bytes[index]===value);
  function utf8(bytes,max){
    if(!(bytes instanceof Uint8Array)||bytes.length>max)return fail("BAD_UTF8","bounded text");
    try{return ok(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch(_){return fail("BAD_UTF8","malformed UTF-8");}
  }
  function validateTlvValue(type,value){
    if(!(value instanceof Uint8Array))return fail("BAD_TLV","value type");
    const u16=o=>(value[o]<<8)|value[o+1],u32=o=>(((value[o]*0x1000000)+(value[o+1]<<16)+(value[o+2]<<8)+value[o+3])>>>0);
    switch(type){
      case C.TLV_TYPES.VERSION_RANGE:return value.length===4&&value[0]<=value[2]?ok(true):fail("BAD_TLV","version range");
      case C.TLV_TYPES.PROFILE_LIST:
      case C.TLV_TYPES.FEC_LIST:{if(value.length<2||value[0]!==value.length-1)return fail("BAD_TLV","list count");const seen=new Set();for(let i=1;i<value.length;i++){if(seen.has(value[i]))return fail("BAD_TLV","duplicate list item");seen.add(value[i]);}return ok(true);}
      case C.TLV_TYPES.GRID_RATES:{if(value.length<5||value[0]<1||value.length!==1+value[0]*4)return fail("BAD_TLV","grid count");const seen=new Set();for(let i=0;i<value[0];i++){const rate=u32(1+i*4);if((rate!==44100&&rate!==48000)||seen.has(rate))return fail("BAD_TLV","grid value");seen.add(rate);}return ok(true);}
      case C.TLV_TYPES.FILE_LIMIT:return value.length===4&&u32(0)>=L.minFileBytes&&u32(0)<=L.maxFileBytes?ok(true):fail("BAD_TLV","file limit");
      case C.TLV_TYPES.CHUNK_RANGE:return value.length===4&&u16(0)>=L.minChunkBytes&&u16(0)<=u16(2)&&u16(2)<=L.maxChunkBytes?ok(true):fail("BAD_TLV","chunk range");
      case C.TLV_TYPES.WINDOW_RANGE:return value.length===4&&u16(0)>=L.minWindow&&u16(0)<=u16(2)&&u16(2)<=L.maxWindow?ok(true):fail("BAD_TLV","window range");
      case C.TLV_TYPES.BURST_LIMITS:return value.length===4&&u16(0)>=1&&u16(0)<=L.maxBurstFrames&&u16(2)>=L.minBurstMs&&u16(2)<=L.maxBurstMs?ok(true):fail("BAD_TLV","burst limits");
      case C.TLV_TYPES.AUDIO_PROCESSING:return value.length===4&&value.every(v=>(v&0xf8)===0)?ok(true):fail("BAD_TLV","audio flags");
      case C.TLV_TYPES.ENDPOINT_NONCE:return value.length===16?ok(true):fail("BAD_TLV","endpoint nonce");
      case C.TLV_TYPES.MANIFEST_ID:return value.length===32?ok(true):fail("BAD_TLV","manifest id");
      case C.TLV_TYPES.TURN_PARAMS:return value.length===4&&u16(0)>=100&&u16(0)<=1500&&u16(2)>=L.minAckTimeoutMs&&u16(2)<=L.maxAckTimeoutMs?ok(true):fail("BAD_TLV","turn parameters");
      case C.TLV_TYPES.ERROR_DETAIL:if(value.length<2||value.length>98)return fail("BAD_TLV","error detail length");return utf8(value.subarray(2),96);
      default:return ok(true);
    }
  }
  function parseTlvs(payload){
    if(!(payload instanceof Uint8Array)||payload.length>L.maxControlPayloadBytes)return fail("LIMIT_RESOURCE","TLV payload");
    const records=[],singleton=new Set();let offset=0;
    while(offset<payload.length){
      if(records.length>=L.maxTlvs||offset>payload.length-4)return fail("BAD_TLV","truncated or too many TLVs");
      const type=payload[offset],flags=payload[offset+1],length=(payload[offset+2]<<8)|payload[offset+3];
      if(flags&0xfe)return fail("BAD_RESERVED","TLV flags");if(length>payload.length-(offset+4))return fail("BAD_TLV","TLV length");
      const known=tlvTypes.has(type);if(!known&&(flags&1))return fail("INCOMPATIBLE_FEATURE","unknown critical TLV");if(known&&singleton.has(type))return fail("BAD_TLV","duplicate singleton TLV");
      const value=payload.subarray(offset+4,offset+4+length),checked=known?validateTlvValue(type,value):ok(true);if(!checked.ok)return checked;
      if(known)singleton.add(type);records.push(Object.freeze({type,critical:!!(flags&1),known,value:value.slice()}));offset+=4+length;
    }
    return ok(Object.freeze(records));
  }
  function encodeTlvs(records){
    if(!Array.isArray(records)||records.length>L.maxTlvs)return fail("BAD_TLV","record count");let length=0;const seen=new Set();
    for(const record of records){if(!record||!Number.isInteger(record.type)||record.type<0||record.type>255||typeof record.critical!=="boolean"||!(record.value instanceof Uint8Array))return fail("BAD_TLV","record");if(tlvTypes.has(record.type)&&seen.has(record.type))return fail("BAD_TLV","duplicate singleton");if(tlvTypes.has(record.type))seen.add(record.type);const check=validateTlvValue(record.type,record.value);if(!check.ok)return check;length+=4+record.value.length;if(length>L.maxControlPayloadBytes)return fail("LIMIT_RESOURCE","TLV payload");}
    const out=new Uint8Array(length);let at=0;for(const record of records){out[at]=record.type;out[at+1]=record.critical?1:0;A.Bytes.writeU16(out,at+2,record.value.length);out.set(record.value,at+4);at+=4+record.value.length;}return ok(out);
  }
  function parseAck(payload,totalChunks,header,paged=false){
    if(!(payload instanceof Uint8Array)||payload.length<32||payload.length>96)return fail("BAD_ACK","length");
    const ackBase=A.Bytes.readU32(payload,0).value,bitmapBits=A.Bytes.readU16(payload,4).value,rangeCount=payload[6];
    if(bitmapBits!==128||rangeCount>L.maxAckRanges||payload[7]!==0||payload.length!==32+rangeCount*8)return fail("BAD_ACK","fixed fields");
    const ackSequence=A.Bytes.readU32(payload,8).value,durableCount=A.Bytes.readU32(payload,12).value;
    if(ackSequence===0||ackBase>totalChunks||durableCount>totalChunks)return fail("BAD_ACK","accounting bounds");if(header&&(header.primaryIndex!==ackBase||header.itemCount!==rangeCount))return fail("BAD_ACK","header accounting");
    const bitmap=payload.slice(16,32),ranges=[];let priorEnd=ackBase+128,represented=0;
    for(let i=0;i<128;i++){const set=!!(bitmap[i>>>3]&(0x80>>>(i&7)));if(set&&ackBase+i>=totalChunks)return fail("BAD_ACK","bitmap beyond total");if(set)represented++;}
    for(let i=0;i<rangeCount;i++){const at=32+i*8,start=A.Bytes.readU32(payload,at).value,length=A.Bytes.readU16(payload,at+4).value,flags=payload[at+6],reserved=payload[at+7];if(length===0||flags!==1||reserved!==0||start<priorEnd||start>totalChunks-length)return fail("BAD_ACK","range ordering");ranges.push(Object.freeze({start,length,durable:true}));priorEnd=start+length;represented+=length;}
    if(!paged&&ackBase===totalChunks){if(durableCount!==totalChunks||represented!==0||bitmap.some(Boolean)||rangeCount!==0)return fail("BAD_ACK","complete accounting");}else if(!paged&&(durableCount<ackBase||durableCount<ackBase+represented))return fail("BAD_ACK","impossible durable count");else if(paged&&durableCount<represented)return fail("BAD_ACK","impossible page durable count");
    return ok(Object.freeze({ackBase,bitmapBits,rangeCount,ackSequence,durableCount,bitmap,ranges:Object.freeze(ranges)}));
  }
  function encodeAck(record,totalChunks,paged=false){
    if(!record||!Number.isInteger(totalChunks)||totalChunks<0||totalChunks>L.maxChunks||!Number.isInteger(record.ackBase)||record.ackBase<0||record.ackBase>totalChunks||!Number.isInteger(record.ackSequence)||record.ackSequence<1||record.ackSequence>0xffffffff||!Number.isInteger(record.durableCount)||record.durableCount<0||record.durableCount>totalChunks)return fail("BAD_ACK","record");
    const bitmap=record.bitmap instanceof Uint8Array?record.bitmap:new Uint8Array(16),ranges=Array.isArray(record.ranges)?record.ranges:[];if(bitmap.length!==16||ranges.length>L.maxAckRanges)return fail("BAD_ACK","bitmap/ranges");
    const out=new Uint8Array(32+ranges.length*8);A.Bytes.writeU32(out,0,record.ackBase);A.Bytes.writeU16(out,4,128);out[6]=ranges.length;A.Bytes.writeU32(out,8,record.ackSequence);A.Bytes.writeU32(out,12,record.durableCount);out.set(bitmap,16);
    for(let i=0;i<ranges.length;i++){const r=ranges[i];if(!r||!Number.isInteger(r.start)||!Number.isInteger(r.length)||r.length<1||r.length>0xffff)return fail("BAD_ACK","range");const at=32+i*8;A.Bytes.writeU32(out,at,r.start);A.Bytes.writeU16(out,at+4,r.length);out[at+6]=1;}
    const parsed=parseAck(out,totalChunks,undefined,paged);return parsed.ok?ok(out):parsed;
  }
  function parsePayload(type,payload,totalChunks,header){
    if(tlvFrames.has(type))return parseTlvs(payload);
    switch(type){
      case T.MANIFEST:return payload.length>=1&&payload.length<=512?ok(Object.freeze({fragment:payload.slice()})):fail("BAD_MANIFEST_FRAGMENT","length");
      case T.MANIFEST_ACK:{if(payload.length!==40)return fail("BAD_MANIFEST_ACK","length");const chunkSize=A.Bytes.readU16(payload,32).value,windowSize=A.Bytes.readU16(payload,34).value,fileLimit=A.Bytes.readU32(payload,36).value;if(chunkSize<L.minChunkBytes||chunkSize>L.maxChunkBytes||windowSize<L.minWindow||windowSize>L.maxWindow||fileLimit<L.minFileBytes||fileLimit>L.maxFileBytes)return fail("BAD_MANIFEST_ACK","bounds");return ok(Object.freeze({manifestId:payload.slice(0,32),chunkSize,windowSize,fileLimit}));}
      case T.DATA:{if(payload.length<12||payload.length>2060)return fail("BAD_DATA","length");const chunkIndex=A.Bytes.readU32(payload,0).value,validLength=A.Bytes.readU16(payload,4).value,reserved=A.Bytes.readU16(payload,6).value,chunkCrc=A.Bytes.readU32(payload,8).value;if(reserved!==0||validLength<1||validLength>L.maxChunkBytes||payload.length!==12+validLength||chunkIndex>=totalChunks||header.primaryIndex!==chunkIndex)return fail("BAD_DATA","fields");const bytes=payload.subarray(12);if(A.Crc32c.digest(bytes)!==chunkCrc)return fail("BAD_CRC","chunk CRC32C");return ok(Object.freeze({chunkIndex,validLength,chunkCrc,bytes:bytes.slice()}));}
      case T.TURN:return payload.length<=32?ok(Object.freeze({bytes:payload.slice()})):fail("BAD_TURN","length");
      case T.ACK:return parseAck(payload,totalChunks,header);
      case T.RESUME_QUERY:{if(payload.length<94||payload.length>1058)return fail("BAD_RESUME","query length");const length=A.Bytes.readU16(payload,32).value;if(length<60||length>L.maxManifestBytes||payload.length!==34+length)return fail("BAD_RESUME","manifest length");return ok(Object.freeze({manifestId:payload.slice(0,32),manifest:payload.slice(34)}));}
      case T.RESUME_STATE:{if(payload.length<64||payload.length>128)return fail("BAD_RESUME","state length");const ack=parseAck(payload.subarray(32),totalChunks,header,true);return ack.ok?ok(Object.freeze({manifestId:payload.slice(0,32),ack:ack.value})):ack;}
      case T.FIN:{if(payload.length!==72)return fail("BAD_FINAL","FIN length");const fileLength=A.Bytes.readU64(payload,64).value;if(fileLength<BigInt(L.minFileBytes)||fileLength>BigInt(L.parserFileCeiling))return fail("LIMIT_FILE","FIN length");return ok(Object.freeze({manifestId:payload.slice(0,32),expectedSha256:payload.slice(32,64),fileLength}));}
      case T.FINAL_ACK:{if(payload.length!==80)return fail("BAD_FINAL","FINAL_ACK length");const fileLength=A.Bytes.readU64(payload,64).value,durableCount=A.Bytes.readU32(payload,72).value,finalAckSequence=A.Bytes.readU32(payload,76).value;if(fileLength<BigInt(L.minFileBytes)||fileLength>BigInt(L.parserFileCeiling)||durableCount!==totalChunks||finalAckSequence<1)return fail("BAD_FINAL","FINAL_ACK accounting");return ok(Object.freeze({manifestId:payload.slice(0,32),expectedSha256:payload.slice(32,64),fileLength,durableCount,finalAckSequence}));}
      case T.FINAL_CONFIRM:return payload.length<=80?ok(Object.freeze({bytes:payload.slice()})):fail("BAD_FINAL","FINAL_CONFIRM length");
      default:return fail("BAD_TYPE","unknown frame type");
    }
  }
  function encodePayload(type,record,totalChunks=0){
    if(tlvFrames.has(type))return encodeTlvs(record&&record.tlvs||[]);if(!record)record={};
    switch(type){
      case T.MANIFEST:return record.fragment instanceof Uint8Array&&record.fragment.length>=1&&record.fragment.length<=512?ok(record.fragment.slice()):fail("BAD_MANIFEST_FRAGMENT","record");
      case T.MANIFEST_ACK:{if(!(record.manifestId instanceof Uint8Array)||record.manifestId.length!==32||!Number.isInteger(record.chunkSize)||record.chunkSize<L.minChunkBytes||record.chunkSize>L.maxChunkBytes||!Number.isInteger(record.windowSize)||record.windowSize<L.minWindow||record.windowSize>L.maxWindow||!Number.isInteger(record.fileLimit)||record.fileLimit<L.minFileBytes||record.fileLimit>L.maxFileBytes)return fail("BAD_MANIFEST_ACK","record");const out=new Uint8Array(40);out.set(record.manifestId);A.Bytes.writeU16(out,32,record.chunkSize);A.Bytes.writeU16(out,34,record.windowSize);A.Bytes.writeU32(out,36,record.fileLimit);return ok(out);}
      case T.DATA:{if(!(record.bytes instanceof Uint8Array)||record.bytes.length<1||record.bytes.length>L.maxChunkBytes||!Number.isInteger(record.chunkIndex)||record.chunkIndex<0||record.chunkIndex>=totalChunks)return fail("BAD_DATA","record");const out=new Uint8Array(12+record.bytes.length);A.Bytes.writeU32(out,0,record.chunkIndex);A.Bytes.writeU16(out,4,record.bytes.length);A.Bytes.writeU32(out,8,A.Crc32c.digest(record.bytes));out.set(record.bytes,12);return ok(out);}
      case T.TURN:return record.bytes instanceof Uint8Array&&record.bytes.length<=32?ok(record.bytes.slice()):fail("BAD_TURN","record");
      case T.ACK:return encodeAck(record,totalChunks);
      case T.RESUME_QUERY:{if(!(record.manifestId instanceof Uint8Array)||record.manifestId.length!==32||!(record.manifest instanceof Uint8Array)||record.manifest.length<60||record.manifest.length>L.maxManifestBytes)return fail("BAD_RESUME","query record");const out=new Uint8Array(34+record.manifest.length);out.set(record.manifestId);A.Bytes.writeU16(out,32,record.manifest.length);out.set(record.manifest,34);return ok(out);}
      case T.RESUME_STATE:{if(!(record.manifestId instanceof Uint8Array)||record.manifestId.length!==32)return fail("BAD_RESUME","state record");const ack=encodeAck(record.ack,totalChunks,true);if(!ack.ok)return ack;const out=new Uint8Array(32+ack.value.length);out.set(record.manifestId);out.set(ack.value,32);return ok(out);}
      case T.FIN:{if(!(record.manifestId instanceof Uint8Array)||record.manifestId.length!==32||!(record.expectedSha256 instanceof Uint8Array)||record.expectedSha256.length!==32||typeof record.fileLength!=="bigint")return fail("BAD_FINAL","FIN record");const out=new Uint8Array(72);out.set(record.manifestId);out.set(record.expectedSha256,32);const written=A.Bytes.writeU64(out,64,record.fileLength);return written.ok?ok(out):written;}
      case T.FINAL_ACK:{const fin=encodePayload(T.FIN,record,totalChunks);if(!fin.ok||!Number.isInteger(record.durableCount)||record.durableCount!==totalChunks||!Number.isInteger(record.finalAckSequence)||record.finalAckSequence<1||record.finalAckSequence>0xffffffff)return fail("BAD_FINAL","FINAL_ACK record");const out=new Uint8Array(80);out.set(fin.value);A.Bytes.writeU32(out,72,record.durableCount);A.Bytes.writeU32(out,76,record.finalAckSequence);return ok(out);}
      case T.FINAL_CONFIRM:return record.bytes instanceof Uint8Array&&record.bytes.length<=80?ok(record.bytes.slice()):fail("BAD_FINAL","FINAL_CONFIRM record");
      default:return fail("BAD_TYPE","unknown frame type");
    }
  }
  function validateHeaderFields(frame,payload,forDecode){
    if(!C.TYPE_NAMES[frame.type])return fail("BAD_TYPE","unknown frame type");if(!Number.isInteger(frame.flags)||frame.flags<0||frame.flags>0xff||(frame.flags&0xc0))return fail("BAD_RESERVED","frame flags");if(frame.flags&F.ENCRYPTED)return fail("INCOMPATIBLE_FEATURE","encryption unsupported in v1.1");
    if(!Number.isInteger(frame.profileId)||(frame.profileId!==C.PROFILES.C0&&frame.profileId!==C.PROFILES.R1)||(frame.type!==T.DATA&&frame.profileId!==C.PROFILES.C0)||(frame.type===T.DATA&&((frame.profileId===C.PROFILES.R1)!==!!(frame.flags&F.MORE))))return fail("BAD_PROFILE","profile/fountain contract");if(frame.fecId!==C.FECS.K7_R12)return fail("BAD_FEC","only K7_R12 enabled");
    if(!Number.isInteger(frame.epoch)||frame.epoch<0||frame.epoch>0xffff||!Number.isInteger(frame.sequence)||frame.sequence<0||frame.sequence>0xffffffff)return fail("BAD_SEQUENCE","epoch/sequence");if(!(frame.sessionId instanceof Uint8Array)||frame.sessionId.length!==16||frame.sessionId.every(v=>v===0))return fail("BAD_SESSION","session id");
    for(const key of ["manifestTag","primaryIndex","totalChunks"])if(!Number.isInteger(frame[key])||frame[key]<0||frame[key]>0xffffffff)return fail("BAD_HEADER",key);for(const key of ["itemCount","windowSize"])if(!Number.isInteger(frame[key])||frame[key]<0||frame[key]>0xffff)return fail("BAD_HEADER",key);
    if(frame.totalChunks>L.maxChunks)return fail("LIMIT_RESOURCE","total chunks");if(frame.windowSize!==0&&(frame.windowSize<L.minWindow||frame.windowSize>L.maxWindow))return fail("LIMIT_RESOURCE","window size");
    const fromReceiver=!!(frame.flags&F.FROM_RECEIVER);if(C.RECEIVER_TYPES.includes(frame.type)&&!fromReceiver)return fail("BAD_DIRECTION","receiver frame flag");if(C.SENDER_TYPES.includes(frame.type)&&fromReceiver)return fail("BAD_DIRECTION","sender frame flag");
    const max=tlvFrames.has(frame.type)?L.maxControlPayloadBytes:(payloadCeiling[frame.type]??L.maxFramePayloadBytes);if(payload.length>max)return fail("LIMIT_RESOURCE","type payload ceiling");
    if(frame.type===T.MANIFEST&&(frame.itemCount!==payload.length||frame.primaryIndex>L.maxManifestBytes-payload.length))return fail("BAD_HEADER","manifest accounting");if(frame.type===T.DATA&&(frame.itemCount!==1||frame.totalChunks<1||frame.primaryIndex>=frame.totalChunks||frame.windowSize===0))return fail("BAD_HEADER","DATA accounting");if(frame.type===T.TURN&&(frame.itemCount>L.maxBurstFrames||frame.totalChunks<1))return fail("BAD_HEADER","TURN accounting");if((frame.type===T.FIN||frame.type===T.FINAL_ACK)&&(frame.itemCount!==0||frame.primaryIndex!==frame.totalChunks))return fail("BAD_HEADER","final accounting");
    if(![T.MANIFEST,T.DATA,T.TURN,T.ACK,T.RESUME_STATE,T.FIN,T.FINAL_ACK].includes(frame.type)&&(frame.primaryIndex!==0||frame.itemCount!==0))return fail("BAD_HEADER","reserved accounting");if(forDecode&&payload.length!==frame.payloadLength)return fail("BAD_LENGTH","payload length");return ok(true);
  }
  function encodeFrame(frame,limits={}){
    try{if(!frame||typeof frame!=="object")return fail("BAD_FRAME","frame record");let payload=frame.payload;if(!(payload instanceof Uint8Array)){const encoded=encodePayload(frame.type,frame.payloadRecord,frame.totalChunks||0);if(!encoded.ok)return encoded;payload=encoded.value;}if(payload.length>L.maxFramePayloadBytes)return fail("LIMIT_RESOURCE","payload");const fields={...frame,payloadLength:payload.length},checked=validateHeaderFields(fields,payload,false);if(!checked.ok)return checked;
      const total=L.headerBytes+payload.length+L.trailerBytes;if(total>L.maxFrameBytes||total>(limits.maxFrameBytes||L.maxFrameBytes))return fail("LIMIT_RESOURCE","frame bytes");const out=new Uint8Array(total);out.set(C.MAGIC_FRAME);out[4]=L.protocolMajor;out[5]=L.protocolMinor;out[6]=frame.type;out[7]=frame.flags;A.Bytes.writeU16(out,8,L.headerBytes);A.Bytes.writeU16(out,10,payload.length);out[12]=frame.profileId;out[13]=frame.fecId;A.Bytes.writeU16(out,14,frame.epoch);A.Bytes.writeU32(out,16,frame.sequence);out.set(frame.sessionId,20);A.Bytes.writeU32(out,36,frame.manifestTag);A.Bytes.writeU32(out,40,frame.primaryIndex);A.Bytes.writeU16(out,44,frame.itemCount);A.Bytes.writeU16(out,46,frame.windowSize);A.Bytes.writeU32(out,48,frame.totalChunks);A.Bytes.writeU32(out,52,A.Crc32c.digest(out.subarray(0,52)));out.set(payload,56);let crc=A.Crc32c.digest(out.subarray(0,56));crc=A.Crc32c.digest(payload,crc);A.Bytes.writeU32(out,56+payload.length,crc);return ok(out);
    }catch(error){return fail("BAD_FRAME",error.message);}
  }
  function decodeFrame(bytes,limits={}){
    try{if(!(bytes instanceof Uint8Array))return fail("BAD_FRAME","input type");if(bytes.length<L.headerBytes+L.trailerBytes||bytes.length>(limits.maxFrameBytes||L.maxFrameBytes))return fail("BAD_LENGTH","bounded total input");if(!sameMagic(bytes,C.MAGIC_FRAME))return fail("BAD_MAGIC","AM1F");const headerLength=A.Bytes.readU16(bytes,8).value;if(headerLength!==L.headerBytes)return fail("BAD_LENGTH","header length");if(A.Bytes.readU32(bytes,52).value!==A.Crc32c.digest(bytes.subarray(0,52)))return fail("BAD_CRC","header CRC32C");
      if(bytes[4]!==L.protocolMajor||bytes[5]!==L.protocolMinor)return fail("BAD_VERSION",bytes[4]+"."+bytes[5]);const type=bytes[6],flags=bytes[7];if(!C.TYPE_NAMES[type])return fail("BAD_TYPE","unknown frame type");if(!Number.isInteger(flags)||(flags&0xc0))return fail("BAD_RESERVED","frame flags");if(flags&F.ENCRYPTED)return fail("INCOMPATIBLE_FEATURE","encryption unsupported in v1.1");const profileId=bytes[12],fecId=bytes[13];if((profileId!==C.PROFILES.C0&&profileId!==C.PROFILES.R1)||(type!==T.DATA&&profileId!==C.PROFILES.C0)||(type===T.DATA&&((profileId===C.PROFILES.R1)!==!!(flags&F.MORE))))return fail("BAD_PROFILE","profile/fountain contract");if(fecId!==C.FECS.K7_R12)return fail("BAD_FEC","only K7_R12 enabled");const payloadLength=A.Bytes.readU16(bytes,10).value;if(payloadLength>L.maxFramePayloadBytes||bytes.length!==L.headerBytes+payloadLength+L.trailerBytes)return fail("BAD_LENGTH","exact frame length");
      const frame={type,flags,profileId,fecId,epoch:A.Bytes.readU16(bytes,14).value,sequence:A.Bytes.readU32(bytes,16).value,sessionId:bytes.subarray(20,36),manifestTag:A.Bytes.readU32(bytes,36).value,primaryIndex:A.Bytes.readU32(bytes,40).value,itemCount:A.Bytes.readU16(bytes,44).value,windowSize:A.Bytes.readU16(bytes,46).value,totalChunks:A.Bytes.readU32(bytes,48).value,payloadLength},view=bytes.subarray(56,56+payloadLength),checked=validateHeaderFields(frame,view,true);if(!checked.ok)return checked;
      if(limits.expectedSessionId&&!A.Bytes.equal(frame.sessionId,limits.expectedSessionId))return fail("SESSION_MISMATCH","session id");if(limits.expectedEpoch!==undefined&&frame.epoch!==limits.expectedEpoch)return fail(frame.epoch<limits.expectedEpoch?"STALE_EPOCH":"EPOCH_MISMATCH","epoch");if(limits.lastSequence!==undefined&&frame.sequence<=limits.lastSequence)return fail("REPLAY","non-increasing frame sequence");if(limits.expectedProfileId!==undefined&&frame.profileId!==limits.expectedProfileId)return fail("PROFILE_MISMATCH","profile");if(limits.expectedManifestTag!==undefined&&frame.manifestTag!==limits.expectedManifestTag)return fail("MANIFEST_MISMATCH","manifest tag");if(limits.expectedTotalChunks!==undefined&&frame.totalChunks!==limits.expectedTotalChunks)return fail("MANIFEST_MISMATCH","chunk count");
      let crc=A.Crc32c.digest(bytes.subarray(0,56));crc=A.Crc32c.digest(view,crc);if(A.Bytes.readU32(bytes,56+payloadLength).value!==crc)return fail("BAD_CRC","frame CRC32C");const payload=view.slice(),parsed=parsePayload(type,payload,frame.totalChunks,frame);if(!parsed.ok)return parsed;if(type===T.DATA&&limits.expectedChunkSize!==undefined){if(!Number.isInteger(limits.expectedChunkSize)||limits.expectedChunkSize<L.minChunkBytes||limits.expectedChunkSize>L.maxChunkBytes||!Number.isSafeInteger(limits.expectedFileLength)||limits.expectedFileLength<L.minFileBytes||limits.expectedFileLength>L.maxFileBytes)return fail("BAD_LIMITS","DATA context");const expected=Math.min(limits.expectedChunkSize,limits.expectedFileLength-frame.primaryIndex*limits.expectedChunkSize);if(parsed.value.validLength!==expected)return fail("BAD_DATA","manifest chunk length");}return ok(Object.freeze({...frame,sessionId:frame.sessionId.slice(),payload,parsed:parsed.value}));
    }catch(error){return fail("BAD_FRAME",error.message);}
  }
  A.Wire=Object.freeze({encodeFrame,decodeFrame,parsePayload,encodePayload,parseTlvs,encodeTlvs,parseAck,encodeAck});
}(globalThis));


/* adapted: phy.js */
(function(root){
  "use strict";
  const A=root.AcousticV1,C=A.Constants,L=C.LIMITS,ok=A.Bytes.ok,fail=A.Bytes.fail;
  if(!A||!A.Resampler)throw new Error("AcousticV1.Resampler required");if(A.PhyTx||A.PhyRx)throw new Error("Acoustic PHY namespace already defined");
  const RAMP_SECONDS=.005,TARGET_RMS=.12,PEAK_LIMIT=.5,MAX_CFO_HZ=100;
  function withPrefix(samples,cp){const out=new Float32Array(samples.length+cp);out.set(samples.subarray(samples.length-cp));out.set(samples,cp);return out;}
  function frequencySymbol(plan,real,imaginary,sequence){
    if(!(real instanceof Float32Array)||!(imaginary instanceof Float32Array)||real.length!==plan.data.length||imaginary.length!==plan.data.length)return fail("BAD_OFDM","data carriers");const positive=[];for(let i=0;i<plan.data.length;i++){if(!Number.isFinite(real[i])||!Number.isFinite(imaginary[i])||Math.hypot(real[i],imaginary[i])>1.000001)return fail("BAD_OFDM","data value");positive.push([plan.data[i],real[i],imaginary[i]]);}for(const bin of plan.pilots)positive.push([bin,A.Preamble.sign(0x50494c4f,sequence,bin)]);return A.Preamble.hermitian(plan,positive);
  }
  function sectionBits(bytes,whiteningSeed,interleaverSeed){const bits=A.Whitening.bytesToBits(bytes);if(!bits.ok)return bits;const white=A.Whitening.apply(bits.value,whiteningSeed);if(!white.ok)return white;const coded=A.Fec.encode(white.value);return coded.ok?A.Interleave.interleave(coded.value,interleaverSeed):coded;}
  function symbolParts(bits,plan,startingSequence,symbolCount){const parts=[];let offset=0;for(let symbol=0;symbol<symbolCount;symbol++){const real=new Float32Array(plan.data.length),imaginary=new Float32Array(plan.data.length),scale=plan.bitsPerCarrier===2?Math.SQRT1_2:1;for(let i=0;i<real.length;i++){real[i]=(offset<bits.length&&bits[offset++]?-1:1)*scale;if(plan.bitsPerCarrier===2)imaginary[i]=(offset<bits.length&&bits[offset++]?-1:1)*scale;}const frequency=frequencySymbol(plan,real,imaginary,startingSequence+symbol);if(!frequency.ok)return frequency;const time=A.Fft.inverseReal(frequency.value.re,frequency.value.im);if(!time.ok)return time;parts.push(withPrefix(time.value,plan.cp));}return ok(parts);}
  function frameLayout(frameBytes,sampleRate,profileId){
    if(!(frameBytes instanceof Uint8Array)||frameBytes.length<L.headerBytes+L.trailerBytes||frameBytes.length>L.maxFrameBytes)return fail("BAD_FRAME","PHY input bytes");const decoded=A.Wire.decodeFrame(frameBytes);if(!decoded.ok)return decoded;if(decoded.value.profileId!==profileId)return fail("PROFILE_MISMATCH","PHY plan");const c0=A.Profiles.plan(C.PROFILES.C0,sampleRate),body=A.Profiles.plan(profileId,sampleRate);if(!c0.ok||!body.ok)return !c0.ok?c0:body;
    const headerCodeBits=(L.headerBytes*8+6)*2,bodyBytes=frameBytes.length-L.headerBytes,bodyCodeBits=(bodyBytes*8+6)*2,headerSymbols=Math.ceil(headerCodeBits/(c0.value.data.length*c0.value.bitsPerCarrier)),bodySymbols=Math.max(L.minPayloadSymbols,Math.ceil(bodyCodeBits/(body.value.data.length*body.value.bitsPerCarrier)));
    if(bodySymbols>L.maxPayloadSymbols)return fail("LIMIT_RESOURCE","body exceeds 320 symbols");const rampSamples=Math.ceil(sampleRate*RAMP_SECONDS),samples=rampSamples+2*body.value.n+2*body.value.symbolSamples+2*headerSymbols*c0.value.symbolSamples+bodySymbols*body.value.symbolSamples+64;
    if(!Number.isSafeInteger(samples)||samples>sampleRate*L.maxPhysicalFrameSeconds)return fail("LIMIT_RESOURCE","four-second physical frame ceiling");return ok(Object.freeze({decoded:decoded.value,c0:c0.value,body:body.value,headerCodeBits,bodyCodeBits,headerSymbols,bodySymbols,rampSamples,tailSamples:64,samples}));
  }
  function scaleAndRamp(waveform,rampSamples,tailSamples){let energy=0,active=0,peak=0;for(const value of waveform){if(!Number.isFinite(value))return fail("BAD_OFDM","non-finite transmit sample");if(value!==0){energy+=value*value;active++;peak=Math.max(peak,Math.abs(value));}}const rms=Math.sqrt(energy/Math.max(1,active)),scale=Math.min(TARGET_RMS/Math.max(rms,1e-12),PEAK_LIMIT/Math.max(peak,1e-12));for(let i=0;i<waveform.length;i++)waveform[i]*=scale;const activeStart=rampSamples,ramp=Math.min(rampSamples,Math.floor((waveform.length-activeStart)/2));for(let i=0;i<ramp;i++){const gain=.5-.5*Math.cos(Math.PI*(i+1)/ramp);waveform[activeStart+i]*=gain;waveform[waveform.length-tailSamples-1-i]*=gain;}let outputPeak=0;for(const value of waveform){if(!Number.isFinite(value)||Math.abs(value)>PEAK_LIMIT+1e-6)return fail("BAD_OFDM","output peak");outputPeak=Math.max(outputPeak,Math.abs(value));}return ok({scale,rmsBeforeScale:rms,peak:outputPeak});}
  function encodeFrame(frameBytes,options={}){
    try{const sampleRate=options.sampleRate,profileId=options.profileId===undefined?(frameBytes[12]||C.PROFILES.C0):options.profileId,layout=frameLayout(frameBytes,sampleRate,profileId);if(!layout.ok)return layout;const p=layout.value,white=A.Whitening.deriveSeed(p.decoded.sessionId,p.decoded.epoch,p.decoded.sequence,p.decoded.profileId),inter=A.Interleave.deriveSeed(p.decoded.sessionId,p.decoded.epoch,p.decoded.sequence,p.decoded.profileId);if(!white.ok||!inter.ok)return !white.ok?white:inter;
      const headerBits=sectionBits(frameBytes.subarray(0,56),C.HEADER_WHITENING_SEED,C.HEADER_INTERLEAVER_SEED),bodyBits=sectionBits(frameBytes.subarray(56),white.value,inter.value);if(!headerBits.ok||!bodyBits.ok)return !headerBits.ok?headerBits:bodyBits;
      const headerA=symbolParts(headerBits.value,p.c0,0,p.headerSymbols),headerB=symbolParts(headerBits.value,p.c0,p.headerSymbols,p.headerSymbols),bodyParts=symbolParts(bodyBits.value,p.body,p.headerSymbols*2,p.bodySymbols);if(!headerA.ok||!headerB.ok||!bodyParts.ok)return !headerA.ok?headerA:!headerB.ok?headerB:bodyParts;
      const parts=[new Float32Array(p.rampSamples)];const short=A.Preamble.short(p.body);if(!short.ok)return short;parts.push(short.value,short.value.slice());for(let i=1;i<=2;i++){const training=A.Preamble.training(p.body,i);if(!training.ok)return training;parts.push(withPrefix(training.value,p.body.cp));}parts.push(...headerA.value,...headerB.value,...bodyParts.value);parts.push(new Float32Array(p.tailSamples));
      let length=0;for(const part of parts){length+=part.length;if(length>p.samples)return fail("LIMIT_RESOURCE","waveform assembly");}if(length!==p.samples)return fail("BAD_OFDM","layout mismatch");const waveform=new Float32Array(length);let at=0;for(const part of parts){waveform.set(part,at);at+=part.length;}const shaping=scaleAndRamp(waveform,p.rampSamples,p.tailSamples);if(!shaping.ok)return shaping;
      return ok(Object.freeze({waveform,metadata:Object.freeze({sampleRate,profileId,profileName:p.body.name,modulation:p.body.modulation,durationSeconds:length/sampleRate,samples:length,headerSymbolsPerCopy:p.headerSymbols,bodySymbols:p.bodySymbols,codedHeaderBits:p.headerCodeBits,codedBodyBits:p.bodyCodeBits,rawBitRate:p.body.rawBitRate,codedInformationRate:p.body.codedInformationRate,wirePayloadRate:p.decoded.payloadLength*8/(length/sampleRate),...shaping.value})}));
    }catch(error){return fail("ENCODE_FAILED",error.message);}
  }
  function encode(intent,plan,outputPool){const frameBytes=intent&&intent.frameBytes,encoded=encodeFrame(frameBytes,{sampleRate:plan&&plan.sampleRate,profileId:plan&&plan.id});if(!encoded.ok||outputPool===undefined)return encoded;if(!Array.isArray(outputPool)||outputPool.length<1||outputPool.length>32||!outputPool.every(block=>block instanceof Float32Array&&block.length>=1&&block.length<=L.maxPcmBlockSamples))return fail("BAD_POOL","output pool");const required=Math.ceil(encoded.value.waveform.length/outputPool[0].length);if(required>outputPool.length)return fail("BACKPRESSURE","output pool capacity");const descriptors=[];let offset=0;for(let i=0;i<required;i++){const block=outputPool[i],length=Math.min(block.length,encoded.value.waveform.length-offset);block.fill(0);block.set(encoded.value.waveform.subarray(offset,offset+length));descriptors.push(Object.freeze({buffer:block.buffer,byteOffset:block.byteOffset,samples:length,sequence:i,final:i===required-1}));offset+=length;}return ok(Object.freeze({descriptors:Object.freeze(descriptors),metadata:encoded.value.metadata}));}
  function receiverHilbert(){const out=new Float64Array(63);for(let n=-31;n<=31;n++){if(n!==0&&(n&1)){const window=.42+.5*Math.cos(Math.PI*n/31)+.08*Math.cos(2*Math.PI*n/31);out[n+31]=2/(Math.PI*n)*window;}}return out;}const RX_HILBERT=receiverHilbert();
  function analytic(samples,index){let q=0;for(let tap=0;tap<63;tap++){const source=index-(tap-31);if(source>=0&&source<samples.length)q+=samples[source]*RX_HILBERT[tap];}return [samples[index],q];}
  function coarseCfo(samples,offset,plan){const half=plan.n/2;let re=0,im=0;for(let i=31;i<plan.n*2-half-31;i++){const a=analytic(samples,offset+i),b=analytic(samples,offset+i+half);re+=b[0]*a[0]+b[1]*a[1];im+=b[1]*a[0]-b[0]*a[1];}if(!Number.isFinite(re)||!Number.isFinite(im)||Math.hypot(re,im)<1e-12)return fail("ACQUISITION_FAILED","CFO observation");const hz=Math.atan2(im,re)*plan.sampleRate/(2*Math.PI*half);return Math.abs(hz)<=MAX_CFO_HZ?ok(hz):fail("ACQUISITION_FAILED","CFO range");}
  function readFft(samples,symbolStart,plan,cfoHz,timing=0){const start=symbolStart+plan.cp+timing;if(start<0||start+plan.n-1>samples.length-1)return fail("TRUNCATED","OFDM symbol");const re=new Float64Array(plan.n),im=new Float64Array(plan.n);for(let i=0;i<plan.n;i++){const position=start+i,value=Number.isInteger(position)?samples[position]:A.Resampler.unchecked(samples,position),phase=-2*Math.PI*cfoHz*position/plan.sampleRate;if(!Number.isFinite(value))return fail("BAD_SAMPLE","fractional read");re[i]=value*Math.cos(phase);im[i]=value*Math.sin(phase);}return A.Fft.transform(re,im,false);}
  function expectedTraining(fft,plan,index){const re=new Float64Array(plan.n),im=new Float64Array(plan.n),domain=index===1?0x54524e31:0x54524e32;for(const bin of plan.usable){const sign=A.Preamble.sign(domain,index,bin);re[bin]=fft.re[bin]*sign;im[bin]=fft.im[bin]*sign;}return {re,im};}
  function channelModel(firstFft,secondFft,plan){const first=expectedTraining(firstFft,plan,1),second=expectedTraining(secondFft,plan,2),re=new Float64Array(plan.n),im=new Float64Array(plan.n);let signal=0,difference=0,crossRe=0,crossIm=0,powerA=0,powerB=0;for(const bin of plan.usable){re[bin]=(first.re[bin]+second.re[bin])/2;im[bin]=(first.im[bin]+second.im[bin])/2;signal+=re[bin]**2+im[bin]**2;difference+=((first.re[bin]-second.re[bin])**2+(first.im[bin]-second.im[bin])**2)/2;crossRe+=second.re[bin]*first.re[bin]+second.im[bin]*first.im[bin];crossIm+=second.im[bin]*first.re[bin]-second.re[bin]*first.im[bin];powerA+=first.re[bin]**2+first.im[bin]**2;powerB+=second.re[bin]**2+second.im[bin]**2;}signal/=plan.usable.length;difference/=plan.usable.length;const usable=new Set(plan.usable);let nullPower=0,nulls=0;for(let bin=1;bin<plan.n/2;bin++)if(!usable.has(bin)){nullPower+=(firstFft.re[bin]**2+firstFft.im[bin]**2+secondFft.re[bin]**2+secondFft.im[bin]**2)/2;nulls++;}nullPower/=Math.max(1,nulls);const noise=Math.max(1e-12,difference,nullPower),consistency=Math.hypot(crossRe,crossIm)/Math.sqrt(Math.max(1e-30,powerA*powerB));return {re,im,signalPower:signal,noisePower:noise,nullPower,consistency,estimatedSnr:signal/noise};}
  function equalize(ar,ai,channel,bin){const br=channel.re[bin],bi=channel.im[bin],power=br*br+bi*bi,regularization=Math.max(channel.noisePower,channel.signalPower*1e-6),denominator=power+regularization;if(!(power>regularization*1e-3)||!Number.isFinite(denominator))return {re:0,im:0,confidence:0,variance:Infinity};return {re:(ar*br+ai*bi)/denominator,im:(ai*br-ar*bi)/denominator,confidence:power/denominator,variance:channel.noisePower/denominator};}
  function phaseFit(fft,channel,plan,sequence){const phases=[],bins=[];for(const bin of plan.pilots){const value=equalize(fft.re[bin],fft.im[bin],channel,bin);if(value.confidence<.03)continue;const sign=A.Preamble.sign(0x50494c4f,sequence,bin);phases.push(Math.atan2(value.im*sign,value.re*sign));bins.push(bin);}if(phases.length<4)return fail("DECODE_FAILED","insufficient pilots");for(let i=1;i<phases.length;i++){while(phases[i]-phases[i-1]>Math.PI)phases[i]-=2*Math.PI;while(phases[i]-phases[i-1]<-Math.PI)phases[i]+=2*Math.PI;}let mx=0,my=0;for(let i=0;i<phases.length;i++){mx+=bins[i];my+=phases[i];}mx/=phases.length;my/=phases.length;let numerator=0,denominator=0;for(let i=0;i<phases.length;i++){numerator+=(bins[i]-mx)*(phases[i]-my);denominator+=(bins[i]-mx)**2;}const slope=denominator?numerator/denominator:0,intercept=my-slope*mx;let residual=0;for(let i=0;i<phases.length;i++)residual+=(phases[i]-intercept-slope*bins[i])**2;return ok({slope,intercept,residualRms:Math.sqrt(residual/phases.length),qualifiedPilots:phases.length});}
  function demap(samples,start,symbolCount,plan,channel,sequence,exactBits,cfo,tracker,metrics){if(symbolCount<0||symbolCount>L.maxPayloadSymbols||exactBits>symbolCount*plan.data.length*plan.bitsPerCarrier)return fail("LIMIT_RESOURCE","demap dimensions");const soft=new Float32Array(exactBits);let at=0;for(let symbol=0;symbol<symbolCount;symbol++){const fft=readFft(samples,start+symbol*plan.symbolSamples,plan,cfo,tracker.phase);if(!fft.ok)return fft;const fit=phaseFit(fft.value,channel,plan,sequence+symbol);if(!fit.ok)return fit;metrics.phaseResidual.push(fit.value.residualRms);metrics.phaseSlope.push(fit.value.slope);const timing=-fit.value.slope*plan.n/(2*Math.PI);if(Math.abs(timing)>=.05){const updated=tracker.update(timing,.1);if(!updated.ok)return updated;}for(const bin of plan.data){if(at>=exactBits)break;const value=equalize(fft.value.re[bin],fft.value.im[bin],channel,bin),phase=fit.value.intercept+fit.value.slope*bin,cos=Math.cos(phase),sin=Math.sin(phase),real=value.re*cos+value.im*sin,imaginary=value.im*cos-value.re*sin,normalizer=value.confidence<.01?0:4*(plan.bitsPerCarrier===2?Math.SQRT2:1)/Math.sqrt(Math.max(1e-6,value.variance));soft[at++]=Math.max(-127,Math.min(127,real*normalizer));if(plan.bitsPerCarrier===2&&at<exactBits)soft[at++]=Math.max(-127,Math.min(127,imaginary*normalizer));}}return ok(soft);}
  function decodeSection(soft,informationBits,whiteningSeed,interleaverSeed){const ordered=A.Interleave.deinterleave(soft,interleaverSeed);if(!ordered.ok)return ordered;const decoded=A.Fec.decode(ordered.value,informationBits);if(!decoded.ok)return decoded;const plain=A.Whitening.apply(decoded.value.bits,whiteningSeed);if(!plain.ok)return plain;const bytes=A.Whitening.bitsToBytes(plain.value);return bytes.ok?ok({bytes:bytes.value,metric:decoded.value.metric,tracebackBytes:decoded.value.tracebackBytes}):bytes;}
  function searchCandidates(samples,plan){const template=A.Preamble.short(plan);if(!template.ok)return template;const end=Math.min(L.maxCandidateOffsets-1,samples.length-2*plan.n);if(end<0)return fail("TRUNCATED","acquisition");let noise=1e-12;const noiseEnd=Math.min(end+1,Math.max(64,Math.floor(plan.sampleRate*.005)));if(noiseEnd>0){let e=0;for(let i=0;i<noiseEnd;i++)e+=samples[i]*samples[i];noise=Math.max(noise,e/noiseEnd);}const candidates=[];for(let offset=0;offset<=end;offset++){let dot=0,energy=0,templateEnergy=0,repeat=0,ra=0,rb=0;for(let i=0;i<plan.n*2;i++){const expected=template.value[i%plan.n],value=samples[offset+i];dot+=value*expected;energy+=value*value;templateEnergy+=expected*expected;if(i<plan.n*2-plan.n/2){const other=samples[offset+i+plan.n/2];repeat+=value*other;ra+=value*value;rb+=other*other;}}const metric=Math.abs(dot)/Math.sqrt(Math.max(1e-30,energy*templateEnergy)),repeated=Math.abs(repeat)/Math.sqrt(Math.max(1e-30,ra*rb)),energyRatio=energy/(plan.n*2*noise);if(metric>=.35&&repeated>=.45&&energyRatio>=1.5){const candidate={offset,metric,repeatedHalfMetric:repeated,energyRatio};const conflict=candidates.findIndex(v=>Math.abs(v.offset-offset)<plan.n/4);if(conflict<0)candidates.push(candidate);else if(metric>candidates[conflict].metric)candidates[conflict]=candidate;candidates.sort((a,b)=>b.metric-a.metric||a.offset-b.offset);if(candidates.length>L.maxCandidates)candidates.length=L.maxCandidates;}}if(!candidates.length)return fail("ACQUISITION_FAILED","energy/repetition/training search");return ok({candidates,examined:end+1,noisePower:noise,rawAmbiguityMargin:candidates.length>1?candidates[0].metric-candidates[1].metric:candidates[0].metric});}
  function inspectHeader(header,expectedProfile){if(!(header instanceof Uint8Array)||header.length!==56)return fail("BAD_HEADER","decoded length");if(!C.MAGIC_FRAME.every((v,i)=>header[i]===v)||A.Bytes.readU16(header,8).value!==56||A.Bytes.readU32(header,52).value!==A.Crc32c.digest(header.subarray(0,52)))return fail("BAD_HEADER","magic/length/CRC");if(header[4]!==1||header[5]!==1||!C.TYPE_NAMES[header[6]]||header[7]&0xe0||header[12]!==expectedProfile||header[13]!==C.FECS.K7_R12||(header[6]===T.DATA&&((header[12]===C.PROFILES.R1)!==!!(header[7]&F.MORE))))return fail("BAD_HEADER","version/type/flags/profile/FEC");const payloadLength=A.Bytes.readU16(header,10).value;if(payloadLength>L.maxFramePayloadBytes)return fail("LIMIT_RESOURCE","decoded payload length");return ok({payloadLength,frameBytes:56+payloadLength+4,profileId:header[12],sessionId:header.slice(20,36),epoch:A.Bytes.readU16(header,14).value,sequence:A.Bytes.readU32(header,16).value});}
  function prepare(samples,plan,candidate){const long1=candidate.offset+2*plan.n,long2=long1+plan.symbolSamples,coarse=coarseCfo(samples,candidate.offset,plan);if(!coarse.ok)return coarse;const fft1=readFft(samples,long1,plan,coarse.value),fft2=readFft(samples,long2,plan,coarse.value);if(!fft1.ok||!fft2.ok)return !fft1.ok?fft1:fft2;const a=expectedTraining(fft1.value,plan,1),b=expectedTraining(fft2.value,plan,2);let re=0,im=0;for(const bin of plan.usable){re+=b.re[bin]*a.re[bin]+b.im[bin]*a.im[bin];im+=b.im[bin]*a.re[bin]-b.re[bin]*a.im[bin];}const fine=Math.atan2(im,re)*plan.sampleRate/(2*Math.PI*plan.symbolSamples),cfo=coarse.value+fine;if(!Number.isFinite(cfo)||Math.abs(cfo)>MAX_CFO_HZ)return fail("ACQUISITION_FAILED","combined CFO");const corrected1=readFft(samples,long1,plan,cfo),corrected2=readFft(samples,long2,plan,cfo);if(!corrected1.ok||!corrected2.ok)return !corrected1.ok?corrected1:corrected2;const channel=channelModel(corrected1.value,corrected2.value,plan);if(channel.consistency<.18||channel.estimatedSnr<.8)return fail("ACQUISITION_FAILED","training gate");return ok({...candidate,long1,long2,coarseCfoHz:coarse.value,fineCfoHz:fine,cfoHz:cfo,channel,score:candidate.metric+.2*candidate.repeatedHalfMetric+.1*channel.consistency});}
  function decodeCandidate(samples,sampleRate,plan,candidate,search){const c0=A.Profiles.plan(C.PROFILES.C0,sampleRate).value,prepared=candidate.channel?ok(candidate):prepare(samples,plan,candidate);if(!prepared.ok)return prepared;const p=prepared.value,headerBits=(56*8+6)*2,headerSymbols=Math.ceil(headerBits/(c0.data.length*c0.bitsPerCarrier)),firstHeader=p.long2+plan.symbolSamples,minHeaderEnd=firstHeader+2*headerSymbols*c0.symbolSamples;if(samples.length<minHeaderEnd)return fail("TRUNCATED","header copies");const metrics={phaseResidual:[],phaseSlope:[]},tracker=new A.Resampler.Tracker(),softA=demap(samples,firstHeader,headerSymbols,c0,p.channel,0,headerBits,p.cfoHz,tracker,metrics);if(!softA.ok)return softA;const decodedA=decodeSection(softA.value,56*8,C.HEADER_WHITENING_SEED,C.HEADER_INTERLEAVER_SEED);if(!decodedA.ok)return decodedA;const softB=demap(samples,firstHeader+headerSymbols*c0.symbolSamples,headerSymbols,c0,p.channel,headerSymbols,headerBits,p.cfoHz,tracker,metrics);if(!softB.ok)return softB;const decodedB=decodeSection(softB.value,56*8,C.HEADER_WHITENING_SEED,C.HEADER_INTERLEAVER_SEED);if(!decodedB.ok)return decodedB;if(!A.Bytes.equal(decodedA.value.bytes,decodedB.value.bytes))return fail("BAD_HEADER","copies differ");const header=inspectHeader(decodedA.value.bytes,plan.id);if(!header.ok)return header;
    const bodyBits=((header.value.frameBytes-56)*8+6)*2,bodySymbols=Math.max(L.minPayloadSymbols,Math.ceil(bodyBits/(plan.data.length*plan.bitsPerCarrier)));if(bodySymbols>L.maxPayloadSymbols)return fail("LIMIT_RESOURCE","decoded body symbols");const bodyStart=minHeaderEnd,bodyEnd=bodyStart+bodySymbols*plan.symbolSamples,required=bodyEnd;if(bodyEnd+64>sampleRate*L.maxPhysicalFrameSeconds+candidate.offset)return fail("LIMIT_RESOURCE","decoded four-second ceiling");if(samples.length<required)return fail("TRUNCATED",String(required));const seed=A.Whitening.deriveSeed(header.value.sessionId,header.value.epoch,header.value.sequence,plan.id),inter=A.Interleave.deriveSeed(header.value.sessionId,header.value.epoch,header.value.sequence,plan.id);if(!seed.ok||!inter.ok)return !seed.ok?seed:inter;const bodySoft=demap(samples,bodyStart,bodySymbols,plan,p.channel,headerSymbols*2,bodyBits,p.cfoHz,tracker,metrics);if(!bodySoft.ok)return bodySoft;const body=decodeSection(bodySoft.value,(header.value.frameBytes-56)*8,seed.value,inter.value);if(!body.ok)return body;const frameBytes=new Uint8Array(header.value.frameBytes);frameBytes.set(decodedA.value.bytes);frameBytes.set(body.value.bytes,56);const frame=A.Wire.decodeFrame(frameBytes);if(!frame.ok)return frame;const mean=values=>values.reduce((sum,v)=>sum+v,0)/Math.max(1,values.length),ambiguity=Number.isFinite(p.validatedAmbiguityMargin)?p.validatedAmbiguityMargin:search.rawAmbiguityMargin;return ok(Object.freeze({frame:frame.value,frameBytes,consumedSamples:Math.min(samples.length,bodyEnd+64),metrics:Object.freeze({acquisitionMetric:p.metric,acquisitionOffsetSamples:p.offset,acquisitionEnergyRatio:p.energyRatio,repeatedHalfMetric:p.repeatedHalfMetric,rawAcquisitionAmbiguityMargin:search.rawAmbiguityMargin,validatedCandidateScore:p.score,validatedCandidateAmbiguityMargin:ambiguity,candidatesExamined:search.examined,candidatesRetained:search.candidates.length,trainingSignalPower:p.channel.signalPower,trainingNoisePower:p.channel.noisePower,trainingNullPower:p.channel.nullPower,trainingEstimatedSnr:p.channel.estimatedSnr,trainingConsistency:p.channel.consistency,coarseCfoHz:p.coarseCfoHz,fineCfoHz:p.fineCfoHz,cfoHz:p.cfoHz,meanPilotResidualRadians:mean(metrics.phaseResidual),meanPhaseSlope:mean(metrics.phaseSlope),...tracker.metrics(),timingDiscontinuities:0})}));}
  function decodeBurst(samples,sampleRate,profileId=C.PROFILES.R1){try{if(!(samples instanceof Float32Array||samples instanceof Float64Array)||samples.length<1||samples.length>sampleRate*L.maxPhysicalFrameSeconds+L.maxCandidateOffsets)return fail("LIMIT_RESOURCE","receiver samples");if(sampleRate!==44100&&sampleRate!==48000)return fail("BAD_SAMPLE_RATE","receiver grid");for(const sample of samples)if(!Number.isFinite(sample)||Math.abs(sample)>4)return fail("BAD_SAMPLE","receiver input");const plan=A.Profiles.plan(profileId,sampleRate);if(!plan.ok)return plan;const search=searchCandidates(samples,plan.value);if(!search.ok)return search;const prepared=[],errors=[];for(const raw of search.value.candidates){const candidate=prepare(samples,plan.value,raw);if(candidate.ok)prepared.push(candidate.value);else errors.push(candidate);}if(!prepared.length){const truncated=errors.find(error=>error.code==="TRUNCATED");return truncated||fail("DECODE_FAILED",errors.map(error=>error.code).join(","));}prepared.sort((a,b)=>b.score-a.score||a.offset-b.offset);for(let i=0;i<prepared.length;i++)prepared[i].validatedAmbiguityMargin=prepared[i].score-(prepared[i+1]?.score||0);if(prepared.length>1&&prepared[0].validatedAmbiguityMargin<.01)return fail("ACQUISITION_AMBIGUOUS","validated candidate score margin");for(const candidate of prepared){const result=decodeCandidate(samples,sampleRate,plan.value,candidate,search.value);if(result.ok)return result;errors.push(result);}const truncated=errors.find(error=>error.code==="TRUNCATED");return truncated||fail("DECODE_FAILED",errors.map(error=>error.code).join(","));}catch(error){return fail("DECODE_FAILED",error.message);}}
  class StreamReceiver{
    constructor(config){if(!config||(config.sampleRate!==44100&&config.sampleRate!==48000))throw new RangeError("invalid stream receiver config");const profileIds=Array.isArray(config.profileIds)?config.profileIds.slice():[config.profileId];if(profileIds.length<1||profileIds.length>2||new Set(profileIds).size!==profileIds.length||profileIds.some(id=>id!==C.PROFILES.C0&&id!==C.PROFILES.R1))throw new RangeError("invalid stream receiver profiles");this.sampleRate=config.sampleRate;this.profileIds=Object.freeze(profileIds);this.profileId=profileIds[0];this.preferredProfile=profileIds[0];this.capacity=this.sampleRate*L.maxPhysicalFrameSeconds+L.maxCandidateOffsets;this.buffer=new Float32Array(this.capacity);this.length=0;this.expectedAbsolute=null;const c0=A.Profiles.plan(C.PROFILES.C0,this.sampleRate).value,headerBits=(L.headerBytes*8+6)*2,headerSymbols=Math.ceil(headerBits/(c0.data.length*c0.bitsPerCarrier));this.minimum=Math.min(...profileIds.map(id=>{const body=A.Profiles.plan(id,this.sampleRate).value;return Math.ceil(this.sampleRate*RAMP_SECONDS)+2*body.n+2*body.symbolSamples+2*headerSymbols*c0.symbolSamples+L.minPayloadSymbols*body.symbolSamples+64;}));this.metrics={blocks:0,queueHighWater:0,overflows:0,discontinuities:0,duplicates:0,outOfOrder:0,frames:0,decodeFailures:0,candidateRateLimited:0};}
    reset(discontinuity=false){this.length=0;this.expectedAbsolute=null;if(discontinuity)this.metrics.discontinuities++;}
    push(block,absoluteFrame,discontinuities=0){if(!(block instanceof Float32Array)||block.length<1||block.length>L.maxPcmBlockSamples||!Number.isSafeInteger(absoluteFrame)||absoluteFrame<0||!Number.isInteger(discontinuities)||discontinuities<0)return [Object.freeze({kind:"METRIC",code:"BAD_RX_BLOCK"})];for(const sample of block)if(!Number.isFinite(sample)||Math.abs(sample)>4)return [Object.freeze({kind:"METRIC",code:"BAD_SAMPLE"})];const events=[];if(discontinuities){this.reset(true);events.push(Object.freeze({kind:"METRIC",code:"DISCONTINUITY",count:discontinuities}));}if(this.expectedAbsolute!==null&&absoluteFrame!==this.expectedAbsolute){if(absoluteFrame<this.expectedAbsolute){this.metrics.outOfOrder++;events.push(Object.freeze({kind:"METRIC",code:"OUT_OF_ORDER"}));return events;}this.reset(true);events.push(Object.freeze({kind:"METRIC",code:"FRAME_GAP"}));}this.expectedAbsolute=absoluteFrame+block.length;this.metrics.blocks++;if(block.length>this.capacity-this.length){this.metrics.overflows++;this.reset(true);events.push(Object.freeze({kind:"METRIC",code:"OVERFLOW"}));return events;}this.buffer.set(block,this.length);this.length+=block.length;this.metrics.queueHighWater=Math.max(this.metrics.queueHighWater,this.length);
      let decodeAttempts=0;while(this.length>0&&decodeAttempts<4){decodeAttempts++;if(this.length<this.minimum)break;const samples=this.buffer.subarray(0,this.length),results=[],firstProfile=this.preferredProfile,first=decodeBurst(samples,this.sampleRate,firstProfile);results.push(first);if(!first.ok&&first.code!=="TRUNCATED"){for(const profileId of this.profileIds){if(profileId===firstProfile)continue;const alternate=decodeBurst(samples,this.sampleRate,profileId);results.push(alternate);if(alternate.ok||alternate.code==="TRUNCATED"){this.preferredProfile=profileId;break;}}}const successful=results.find(result=>result.ok);if(successful){const consumed=successful.value.consumedSamples;events.push(Object.freeze({kind:"RX_FRAME",frame:successful.value.frame,frameBytes:successful.value.frameBytes,metrics:successful.value.metrics}));this.buffer.copyWithin(0,consumed,this.length);this.length-=consumed;this.metrics.frames++;continue;}if(results.some(result=>result.code==="TRUNCATED"))break;this.metrics.decodeFailures++;const discard=Math.min(64,this.length),code=results.map(result=>result.code).join("+");this.buffer.copyWithin(0,discard,this.length);this.length-=discard;if(this.metrics.decodeFailures%256===1)events.push(Object.freeze({kind:"METRIC",code}));if(this.length<this.minimum)break;}if(this.length>=this.minimum&&decodeAttempts>=4)this.metrics.candidateRateLimited++;return events;}
    snapshotMetrics(){return Object.freeze({...this.metrics,profileIds:this.profileIds,preferredProfile:this.preferredProfile,bufferedSamples:this.length,capacitySamples:this.capacity});}
  }
  function create(config){try{return ok(new StreamReceiver(config));}catch(error){return fail("BAD_CONFIG",error.message);}}
  A.PhyTx=Object.freeze({encodeFrame,encode,frameLayout});A.PhyRx=Object.freeze({decodeBurst,StreamReceiver,create});
}(globalThis));
