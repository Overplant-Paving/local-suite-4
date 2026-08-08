"use strict";

class LocalSuiteAcousticIo extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const supplied = options.processorOptions || {};
    this.generation = Number.isSafeInteger(supplied.generation) ? supplied.generation : 0;
    this.captureFrames = supplied.captureFrames === 4096 ? 4096 : 4096;
    this.capture = new Float32Array(this.captureFrames);
    this.captureOffset = 0;
    this.absoluteInputFrame = 0;
    this.playQueue = [];
    this.playItem = null;
    this.playOffset = 0;
    this.stopped = false;
    this.port.onmessage = event => this.control(event.data || {});
    this.port.postMessage({kind: "READY", generation: this.generation, sampleRate});
  }

  control(message) {
    if (message.generation !== this.generation) return;
    if (message.kind === "PLAY" && message.samples instanceof Float32Array) {
      if (this.playQueue.length >= 2 || this.playItem) {
        this.port.postMessage({kind: "PLAY_REJECTED", generation: this.generation,
          id: message.id, reason: "playback queue full"});
        return;
      }
      this.playQueue.push({id: message.id, samples: message.samples});
      this.port.postMessage({kind: "PLAY_QUEUED", generation: this.generation, id: message.id});
    } else if (message.kind === "STOP") {
      this.stopped = true;
      this.playQueue.length = 0;
      this.playItem = null;
      this.port.postMessage({kind: "STOPPED", generation: this.generation});
    }
  }

  flushCapture() {
    const block = this.capture;
    let energy = 0;
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      const value = block[i];
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const absoluteFrame = this.absoluteInputFrame - block.length;
    this.port.postMessage({kind: "CAPTURE", generation: this.generation, samples: block,
      absoluteFrame, rms: Math.sqrt(energy / block.length), peak}, [block.buffer]);
    this.capture = new Float32Array(this.captureFrames);
    this.captureOffset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    const frames = output ? output.length : (input ? input.length : 128);
    if (output) output.fill(0);
    if (this.stopped) return true;

    if (input) {
      let source = 0;
      while (source < input.length) {
        const count = Math.min(input.length - source, this.capture.length - this.captureOffset);
        this.capture.set(input.subarray(source, source + count), this.captureOffset);
        source += count;
        this.captureOffset += count;
        this.absoluteInputFrame += count;
        if (this.captureOffset === this.capture.length) this.flushCapture();
      }
    } else {
      this.absoluteInputFrame += frames;
    }

    if (output) {
      let target = 0;
      while (target < output.length) {
        if (!this.playItem) {
          this.playItem = this.playQueue.shift() || null;
          this.playOffset = 0;
          if (!this.playItem) break;
          this.port.postMessage({kind: "PLAY_STARTED", generation: this.generation,
            id: this.playItem.id});
        }
        const count = Math.min(output.length - target,
          this.playItem.samples.length - this.playOffset);
        output.set(this.playItem.samples.subarray(this.playOffset, this.playOffset + count), target);
        target += count;
        this.playOffset += count;
        if (this.playOffset === this.playItem.samples.length) {
          const id = this.playItem.id;
          this.playItem = null;
          this.port.postMessage({kind: "PLAYED", generation: this.generation, id});
        }
      }
    }
    return true;
  }
}

registerProcessor("local-suite-acoustic-io", LocalSuiteAcousticIo);
