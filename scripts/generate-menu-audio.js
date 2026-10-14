#!/usr/bin/env node
// Original, deterministic PCM cues. Run from any directory; no external encoder is needed.
const fs = require("node:fs");
const path = require("node:path");

const sampleRate = 22050;
const cues = {
  select: { duration: 0.045, notes: [520] },
  confirm: { duration: 0.105, notes: [520, 690] },
  back: { duration: 0.085, notes: [440, 330] },
};

function generateCue(name) {
  const { duration, notes } = cues[name];
  const count = Math.round(sampleRate * duration);
  const wave = Buffer.alloc(44 + count * 2);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index++) {
    const time = index / sampleRate;
    const noteIndex = Math.min(
      notes.length - 1,
      Math.floor((time / duration) * notes.length),
    );
    const localTime = time - (noteIndex * duration) / notes.length;
    const noteDuration = duration / notes.length;
    const envelope = Math.sin((Math.PI * localTime) / noteDuration);
    const sample =
      0.09 *
      envelope *
      envelope *
      Math.sin(2 * Math.PI * notes[noteIndex] * time);
    wave.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return wave;
}

if (require.main === module) {
  const destination = path.resolve(__dirname, "../public/audio/menu");
  fs.mkdirSync(destination, { recursive: true });
  Object.keys(cues).forEach((name) => {
    const bytes = generateCue(name);
    fs.writeFileSync(path.join(destination, `${name}.wav`), bytes);
    process.stdout.write(`${name}.wav: ${bytes.length} bytes\n`);
  });
}
module.exports = { generateCue, cues };
