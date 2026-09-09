import json, math, sys, wave
from array import array

wav_path, out_path = sys.argv[1], sys.argv[2]

def goertzel(samples, rate, target):
    if not samples:
        return 0.0
    w = 2.0 * math.pi * target / rate
    coeff = 2.0 * math.cos(w)
    s0 = s1 = s2 = 0.0
    for x in samples:
        s0 = float(x) + coeff * s1 - s2
        s2, s1 = s1, s0
    return s1*s1 + s2*s2 - coeff*s1*s2

with wave.open(wav_path, 'rb') as wf:
    ch = wf.getnchannels(); sw = wf.getsampwidth(); rate = wf.getframerate(); frames = wf.getnframes()
    raw = wf.readframes(frames)
if sw != 2:
    raise RuntimeError(f'expected 16-bit PCM, got sample width {sw}')
vals = array('h'); vals.frombytes(raw)
mono = vals[0::ch] if ch > 1 else vals
if not mono:
    raise RuntimeError('captured WAV contains no samples')
mean_sq = sum(float(v)*float(v) for v in mono) / len(mono)
rms = math.sqrt(mean_sq)
window = rate
windows = []
for i in range(0, len(mono), window):
    s = mono[i:i+window]
    if len(s) < rate//2:
        continue
    wrms = math.sqrt(sum(float(v)*float(v) for v in s) / len(s))
    p440 = goertzel(s, rate, 440.0)
    p880 = goertzel(s, rate, 880.0)
    windows.append({'index': i//window, 'rms': wrms, 'p440': p440, 'p880': p880})
max440 = max((w['p440'] for w in windows), default=0.0)
max880 = max((w['p880'] for w in windows), default=0.0)
summary = {
    'path': wav_path,
    'channels': ch,
    'sampleWidth': sw,
    'sampleRate': rate,
    'frames': frames,
    'durationSeconds': frames / float(rate),
    'rms': rms,
    'max440Power': max440,
    'max880Power': max880,
    'nonSilent': rms > 20.0,
    'detected440': max440 > 1e10,
    'detected880': max880 > 1e10,
    'windows': windows,
}
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=2)
print(json.dumps(summary))
