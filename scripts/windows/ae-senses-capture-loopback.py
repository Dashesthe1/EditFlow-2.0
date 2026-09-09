import sys, time, wave
import pyaudiowpatch as pyaudio

out_path = sys.argv[1]
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
chunk = 1024
with pyaudio.PyAudio() as p:
    dev = p.get_default_wasapi_loopback()
    rate = int(dev['defaultSampleRate'])
    channels = int(dev['maxInputChannels'])
    if channels < 1:
        raise RuntimeError('Default WASAPI loopback device has no input channels')
    channels = min(channels, 2)
    fmt = pyaudio.paInt16
    with wave.open(out_path, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(p.get_sample_size(fmt))
        wf.setframerate(rate)
        with p.open(format=fmt, channels=channels, rate=rate, input=True,
                    input_device_index=int(dev['index']), frames_per_buffer=chunk) as stream:
            remaining = int(rate * duration)
            while remaining > 0:
                n = min(chunk, remaining)
                data = stream.read(n, exception_on_overflow=False)
                wf.writeframes(data)
                remaining -= n
print(f'captured={out_path} rate={rate} channels={channels} duration={duration}')
