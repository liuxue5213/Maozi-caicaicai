// 生成简单的音效 WAV 文件（16-bit PCM 单声道 22050Hz）
// 用法: node scripts/gen-sounds.js
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;

function tone(freq, durationMs, volume = 0.5, fadeMs = 10) {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const fadeSamples = Math.round((fadeMs / 1000) * SAMPLE_RATE);
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    let env = 1;
    if (i < fadeSamples) env = i / fadeSamples;
    if (i > samples - fadeSamples) env = (samples - i) / fadeSamples;
    out[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * volume * env;
  }
  return out;
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float64Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function slide(fromFreq, toFreq, durationMs, volume = 0.5) {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const out = new Float64Array(samples);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const freq = fromFreq + (toFreq - fromFreq) * t;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.min(1, (i / samples) * 8, ((samples - i) / samples) * 8);
    out[i] = Math.sin(phase) * volume * env;
  }
  return out;
}

const sounds = {
  // 出拳：短促上滑"啵"
  'choice.wav': slide(500, 900, 90, 0.6),
  // 胜：上行双音
  'win.wav': concat(tone(523, 110, 0.5), tone(784, 220, 0.5)),
  // 负：下行双音
  'lose.wav': concat(tone(392, 130, 0.45), tone(262, 260, 0.45)),
  // 平：中性单音
  'draw.wav': tone(440, 160, 0.45),
  // 终局胜利：上行三连音
  'game-win.wav': concat(tone(523, 100, 0.5), tone(659, 100, 0.5), tone(880, 280, 0.5)),
  // 终局失败：下行三连音
  'game-lose.wav': concat(tone(440, 120, 0.45), tone(349, 120, 0.45), tone(262, 300, 0.45)),
};

const outDir = path.join(__dirname, '..', 'assets', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, samples] of Object.entries(sounds)) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(path.join(outDir, name), buffer);
  console.log(`生成 ${name} (${(dataSize / 1024).toFixed(1)} KB)`);
}
