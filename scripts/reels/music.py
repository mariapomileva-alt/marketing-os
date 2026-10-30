"""Original calm music for Back's Reels and ads: soft pad chords, a gentle bell to open, a sparse melody, a warm
resolving chord with a bell on the end card. Fully synthesized (no samples, no licensed tracks).

usage: music.py OUT.wav DURATION END_AT [SEED] [MOOD]
MOOD: warm (D major, kalimba), night (low A minor, soft felt piano), airy (E major, bells), piano (C major, piano),
dawn (G major, slow kalimba).
Each seed gives a different melody, so no two Reels sound the same.
"""
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 48000
out = sys.argv[1]
dur = float(sys.argv[2])
end_at = float(sys.argv[3])
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 1
mood = sys.argv[5] if len(sys.argv) > 5 else "warm"
rng = np.random.default_rng(seed)
N = int(SR * (dur + 3))
L = np.zeros(N); R = np.zeros(N)

MOODS = {
    # chords (MIDI), resolve chord, melody scale, melody instrument, gaps between notes, pad brightness, bells (open, end)
    "warm": dict(chords=[[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 57, 59], [45, 52, 54, 57, 59]],
                 resolve=[50, 57, 61, 64, 69], scale=[74, 76, 78, 81, 83, 86], inst="kalimba", gaps=[0.9, 1.2, 1.5, 1.8],
                 cutoff=1800, bells=(81, 74, 78, 85)),
    "night": dict(chords=[[45, 52, 55, 59, 60], [41, 48, 52, 55, 57], [36, 43, 48, 52, 55], [43, 50, 53, 55, 59]],
                  resolve=[45, 52, 57, 60, 64], scale=[64, 67, 69, 71, 72, 76], inst="felt", gaps=[1.4, 1.8, 2.2, 2.6],
                  cutoff=1200, bells=(76, 69, 72, 79)),
    "airy": dict(chords=[[52, 59, 63, 66, 68], [49, 56, 59, 63, 64], [45, 52, 56, 59, 61], [47, 54, 56, 59, 61]],
                 resolve=[52, 59, 63, 66, 71], scale=[76, 78, 80, 83, 85, 88], inst="bell", gaps=[1.0, 1.3, 1.6, 2.0],
                 cutoff=2600, bells=(83, 76, 80, 88)),
    "piano": dict(chords=[[48, 55, 59, 62, 64], [45, 52, 55, 59, 60], [41, 48, 52, 55, 57], [43, 50, 52, 55, 59]],
                  resolve=[48, 55, 60, 64, 67], scale=[67, 69, 72, 74, 76, 79], inst="piano", gaps=[0.8, 1.2, 1.6, 2.0],
                  cutoff=1600, bells=(79, 72, 76, 84)),
    # Dawn: G major, slow harp-like kalimba over open fifths, a little brighter than warm.
    "dawn": dict(chords=[[43, 50, 55, 59, 62], [40, 47, 52, 55, 59], [36, 43, 48, 52, 55], [38, 45, 50, 54, 57]],
                 resolve=[43, 50, 55, 59, 67], scale=[71, 74, 76, 79, 81, 83], inst="kalimba", gaps=[1.1, 1.4, 1.8, 2.2],
                 cutoff=2000, bells=(83, 79, 74, 86)),
}
M = MOODS.get(mood, MOODS["warm"])


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def env(n, a, r, sustain_until):
    t = np.arange(n) / SR
    e = np.minimum(1, t / a)
    rel = np.clip((t - sustain_until) / r, 0, 1)
    return e * (1 - rel) ** 2


def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan))
    R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def pad(notes, length):
    n = int((length + 2.5) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        f = hz(m)
        for det in (-0.12, 0.12):  # gentle chorus
            ff = f * 2 ** (det / 12)
            s += np.sin(2 * np.pi * ff * t) + 0.25 * np.sin(2 * np.pi * 2 * ff * t + 0.3) + 0.08 * np.sin(2 * np.pi * 3 * ff * t)
    s *= env(n, 1.4, 2.2, length)
    s = sosfilt(butter(2, M["cutoff"], fs=SR, output="sos"), s)
    return s / (len(notes) * 4)


def bell(m, length=4.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.zeros(n)
    for ratio, amp, dec in ((1, 1, 2.8), (2.76, 0.45, 1.6), (5.4, 0.2, 0.9), (8.93, 0.08, 0.5)):
        s += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / dec)
    return s * np.minimum(1, t / 0.004) * 0.35


def kalimba(m, length=2.5):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 3.0 * f * t) * np.exp(-t / 0.08)) * np.exp(-t / 0.7)
    return s * np.minimum(1, t / 0.003) * 0.28


def piano(m, length=3.5, felt=False):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.zeros(n)
    partials = ((1, 1.0, 1.6), (2, 0.35, 0.9), (3, 0.12, 0.5), (4, 0.05, 0.3)) if felt else ((1, 1.0, 1.4), (2, 0.5, 0.8), (3, 0.25, 0.45), (4, 0.12, 0.3), (5, 0.06, 0.2))
    for k, amp, dec in partials:
        fk = f * k * (1 + 0.0004 * k * k)  # slight stretch like real strings
        s += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t / dec)
    attack = 0.012 if felt else 0.004
    s *= np.minimum(1, t / attack)
    if felt:
        s = sosfilt(butter(2, 1400, fs=SR, output="sos"), s)
    return s * 0.24


def note(m):
    inst = M["inst"]
    if inst == "kalimba":
        return kalimba(m)
    if inst == "bell":
        return bell(m, 3.0) * 0.55
    return piano(m, felt=(inst == "felt"))


# Chords: four-bar progression, repeated for long Reels; then resolve on the end card.
chords = M["chords"]
bars = max(4, int(round((end_at - 0.2) / 4.5)))
step = max(2.6, (end_at - 0.2) / bars)
for k in range(bars):
    add(pad(chords[k % 4], step + 0.6), 0.15 + k * step, pan=(-0.15 if k % 2 else 0.15), gain=1.0)
add(pad(M["resolve"], dur - end_at + 0.5), end_at - 0.1, gain=1.15)

# Opening bell (catches attention softly) and one on the end card.
b = M["bells"]
add(bell(b[0]), 0.05, pan=0.2, gain=1.0)
add(bell(b[1], 3), 0.05, pan=-0.2, gain=0.5)
add(bell(b[2]), end_at, pan=-0.1, gain=0.9)
add(bell(b[3], 3.5), end_at + 0.35, pan=0.25, gain=0.45)

# Sparse melody over the chords (pentatonic, unhurried), stepwise more often than leaps.
scale = M["scale"]
t = 1.6
idx = int(rng.integers(0, len(scale)))
while t < end_at - 0.8:
    idx = int(np.clip(idx + rng.choice([-2, -1, -1, 0, 1, 1, 2]), 0, len(scale) - 1))
    add(note(scale[idx]), t, pan=float(rng.uniform(-0.5, 0.5)), gain=float(rng.uniform(0.6, 0.9)))
    t += float(rng.choice(M["gaps"]))

# Soft room: a synthetic reverb tail.
ir_n = int(2.8 * SR)
tt = np.arange(ir_n) / SR
ir = rng.standard_normal(ir_n) * np.exp(-tt / (1.2 if mood == "night" else 0.9))
ir = sosfilt(butter(2, 4000, fs=SR, output="sos"), ir)
ir /= np.sqrt(np.sum(ir ** 2))
wetL = fftconvolve(L, ir)[:N]
wetR = fftconvolve(R, np.roll(ir, 240))[:N]
mixL = 0.75 * L + 0.45 * wetL
mixR = 0.75 * R + 0.45 * wetR
n_out = int(dur * SR)
st = np.stack([mixL[:n_out], mixR[:n_out]], axis=1)
fade = int(1.2 * SR)
st[-fade:] *= np.linspace(1, 0, fade)[:, None]
st[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
st /= np.max(np.abs(st)) * 1.12
wavfile.write(out, SR, (st * 32767).astype(np.int16))
