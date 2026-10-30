"""Soft ambient beds to sit UNDER a voice (calm videos, their Shorts and Reels). No bells, no melody, no attacks:
only slow, warm chords that melt into each other, a quiet low drone and (for "tide") a filtered sea swell. Everything
is kept below the speech range, so the voice always stays clear on top. Fully synthesized (no samples or licences).

usage: ambient_voice.py OUT.wav DURATION [SEED] [VARIANT]
VARIANT: drift (warm D major, slow tape-like pads), tide (A minor 9 with a soft sea swell), glow (E major, airy and light).
"""
import sys
import wave
import numpy as np
from scipy.signal import oaconvolve, butter, sosfilt

SR = 44100
out = sys.argv[1]
dur = float(sys.argv[2])
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
variant = sys.argv[4] if len(sys.argv) > 4 else "drift"
rng = np.random.default_rng(seed)
N = int(SR * (dur + 8))

VARIANTS = {
    # chords (MIDI), low drone, chord length (s), pad brightness (Hz), sea swell level
    "drift": dict(prog=[[38, 50, 54, 57, 61, 64], [35, 47, 50, 54, 57, 61], [31, 43, 47, 50, 54, 57], [33, 45, 49, 52, 56, 59]],
                  drone=26, length=(15, 20), cutoff=(700, 1100), sea=0.0),
    "tide": dict(prog=[[33, 45, 48, 52, 55, 59], [29, 41, 45, 48, 52, 55], [36, 48, 52, 55, 59, 62], [31, 43, 47, 50, 52, 57]],
                 drone=21, length=(16, 22), cutoff=(600, 950), sea=0.11),
    "glow": dict(prog=[[40, 52, 56, 59, 63, 66], [37, 49, 52, 56, 59, 64], [33, 45, 49, 52, 56, 61], [35, 47, 51, 54, 56, 61]],
                 drone=28, length=(13, 18), cutoff=(900, 1400), sea=0.0),
}
V = VARIANTS.get(variant, VARIANTS["drift"])
L = np.zeros(N, dtype=np.float32)
R = np.zeros(N, dtype=np.float32)


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def lowpass(s, f, order=2):
    return sosfilt(butter(order, f, fs=SR, output="sos"), s)


def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    s = (sig[: j - i] * gain).astype(np.float32)
    L[i:j] += s * np.float32(np.sqrt(0.5 * (1 - pan)))
    R[i:j] += s * np.float32(np.sqrt(0.5 * (1 + pan)))


def pad(notes, length, cutoff):
    """A chord with very slow attack and release; each note breathes on its own, gently chorused."""
    attack, release = 6.0, 8.0
    n = int((length + release) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, m in enumerate(notes):
        f = hz(m)
        level = 1.0 if k else 0.8
        breath = 0.7 + 0.3 * np.sin(2 * np.pi * rng.uniform(0.03, 0.08) * t + rng.uniform(0, 6.28))
        for det in (-0.07, 0.0, 0.07):
            ff = f * 2 ** (det / 12)
            ph = rng.uniform(0, 6.28)
            s += level * breath * (np.sin(2 * np.pi * ff * t + ph) + 0.12 * np.sin(4 * np.pi * ff * t + ph))
    e = (np.minimum(1, t / attack) ** 2) * (np.clip(1 - (t - length) / release, 0, 1) ** 2)
    return lowpass(s * e, cutoff) / (len(notes) * 5.0)


# 1. Chords, each one fading in while the last fades out.
t = 0.0
k = int(rng.integers(0, 4))
while t < dur:
    length = float(rng.uniform(*V["length"]))
    add(pad(V["prog"][k % 4], length, float(rng.uniform(*V["cutoff"]))), t, pan=float(rng.uniform(-0.2, 0.2)))
    t += length
    k += int(rng.choice([1, 1, 1, 2, -1]))

# 2. Low drone: the floor under everything, felt more than heard.
td = np.arange(N) / SR
drone = np.sin(2 * np.pi * hz(V["drone"] + 12) * td) + 0.5 * np.sin(2 * np.pi * hz(V["drone"] + 19) * td)
drone *= 0.75 + 0.25 * np.sin(2 * np.pi * 0.017 * td)
add(lowpass(drone, 300) * 0.06, 0)
del drone

# 3. Tide: brown noise shaped into slow waves (8-12 s), dark, like the sea far away.
if V["sea"]:
    noise = np.cumsum(rng.standard_normal(N)) / SR
    noise = lowpass(noise - lowpass(noise, 20), 700)
    noise /= np.max(np.abs(noise)) + 1e-9
    swell = np.zeros(N)
    pos = 0.0
    while pos < dur + 8:
        period = rng.uniform(8, 12)
        a, b = int(pos * SR), min(N, int((pos + period) * SR))
        x = np.linspace(0, 1, b - a)
        swell[a:b] = np.sin(np.pi * x) ** 2 * rng.uniform(0.6, 1.0)
        pos += period
    add(noise * swell * V["sea"] * 2.2, 0, pan=-0.1)
    add(np.roll(noise, SR) * np.roll(swell, int(SR * 3)) * V["sea"] * 2.0, 0, pan=0.15)
    del noise, swell

# 4. A large, dark room.
ir_n = int(5.0 * SR)
tt = np.arange(ir_n) / SR
ir = rng.standard_normal(ir_n) * np.exp(-tt / 1.8)
ir = lowpass(ir, 2500)
ir /= np.sqrt(np.sum(ir ** 2))
ir = ir.astype(np.float32)
n_out = int(dur * SR)
wl = oaconvolve(L, ir)[:n_out]
wr = oaconvolve(R, np.roll(ir, 400))[:n_out]
st = np.stack([0.6 * L[:n_out] + 0.6 * wl, 0.6 * R[:n_out] + 0.6 * wr], axis=1)
del wl, wr
# Keep the speech range free: everything above ~1.8 kHz rolled off.
st[:, 0] = lowpass(st[:, 0], 1800, 4)
st[:, 1] = lowpass(st[:, 1], 1800, 4)
fi = int(min(5.0, dur / 6) * SR)
fo = int(min(6.0, dur / 5) * SR)
st[:fi] *= np.linspace(0, 1, fi)[:, None]
st[-fo:] *= np.linspace(1, 0, fo)[:, None]
st /= np.max(np.abs(st)) * 1.12
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
