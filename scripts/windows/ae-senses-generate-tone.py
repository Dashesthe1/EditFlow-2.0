import math, struct, sys, wave
out = sys.argv[1]
rate = 48000
amp = 12000
segments = [(0.75, 0.0), (1.0, 440.0), (0.25, 0.0), (1.0, 880.0), (1.0, 0.0)]
with wave.open(out, 'wb') as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(rate)
    phase = 0
    for dur, freq in segments:
        n = int(rate * dur)
        for i in range(n):
            if freq <= 0:
                v = 0
            else:
                v = int(amp * math.sin(2.0 * math.pi * freq * (i / rate)))
            wf.writeframesraw(struct.pack('<hh', v, v))
print(out)
