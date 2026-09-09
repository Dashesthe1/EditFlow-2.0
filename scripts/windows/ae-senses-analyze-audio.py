import json, math, statistics, sys, wave
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
    return max(0.0, s1*s1 + s2*s2 - coeff*s1*s2)

def dominance(windows, key):
    if not windows:
        return (0.0, -1, 0.0)
    powers = [float(w[key]) for w in windows]
    idx = max(range(len(powers)), key=powers.__getitem__)
    peak = powers[idx]
    others = [p for j, p in enumerate(powers) if j != idx]
    floor = statistics.median(others) if others else 0.0
    ratio = peak / max(floor, 1.0)
    return (ratio, idx, peak)

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
peak_abs = max(abs(int(v)) for v in mono)
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
ratio440, idx440, max440 = dominance(windows, 'p440')
ratio880, idx880, max880 = dominance(windows, 'p880')
# We deliberately use relative spectral dominance, not an arbitrary PCM amplitude.
# AE/Windows may attenuate preview output heavily, but a sensory path is proven when
# the expected frequencies emerge far above each frequency's captured noise floor
# in the expected temporal order.
detected440 = ratio440 >= 20.0
detected880 = ratio880 >= 20.0
ordered_pattern = idx440 >= 0 and idx880 > idx440
non_silent = peak_abs > 0 and (detected440 or detected880)
summary = {
    'path': wav_path,
    'channels': ch,
    'sampleWidth': sw,
    'sampleRate': rate,
    'frames': frames,
    'durationSeconds': frames / float(rate),
    'rms': rms,
    'peakAbsSample': peak_abs,
    'max440Power': max440,
    'max880Power': max880,
    'dominance440': ratio440,
    'dominance880': ratio880,
    'dominant440Window': idx440,
    'dominant880Window': idx880,
    'orderedPattern': ordered_pattern,
    'nonSilent': non_silent,
    'detected440': detected440 and ordered_pattern,
    'detected880': detected880 and ordered_pattern,
    'windows': windows,
}
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=2)
print(json.dumps(summary))
