"""Original calm music for the Back ads: soft pad chords, a gentle bell to open, sparse kalimba notes,
a warm resolving chord with a bell on the end card. Fully synthesized (no samples), so no licensing issues."""
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 48000
dur = float(sys.argv[2])
end_at = float(sys.argv[3])
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 1
out = sys.argv[1]
rng = np.random.default_rng(seed)
N = int(SR * (dur + 3))
L = np.zeros(N); R = np.zeros(N)


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def env(n, a, r, sustain_until):
    t = np.arange(n) / SR
    e = np.minimum(1, t / a)
    rel = np.clip((t - sustain_until) / r, 0, 1)
    return e * (1 - rel) ** 2


def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan))
    R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def pad(notes, start, length):
    n = int((length + 2.5) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        f = hz(m)
        for det in (-0.12, 0.12):  # gentle chorus
            ff = f * 2 ** (det / 12)
            s += np.sin(2 * np.pi * ff * t) + 0.25 * np.sin(2 * np.pi * 2 * ff * t + 0.3) + 0.08 * np.sin(2 * np.pi * 3 * ff * t)
    s *= env(n, 1.4, 2.2, length)
    s = sosfilt(butter(2, 1800, fs=SR, output="sos"), s)
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


# D major, calm: Dmaj9 – Bm9 – Gmaj7 – A6sus, then resolve to Dmaj9 on the end card.
chords = [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 57, 59], [45, 52, 54, 57, 59]]
step = max(2.6, (end_at - 0.2) / 4)
for k, c in enumerate(chords):
    add(pad(c, 0, step + 0.6), 0.15 + k * step, pan=(-0.15 if k % 2 else 0.15), gain=1.0)
add(pad([50, 57, 61, 64, 69], 0, dur - end_at + 0.5), end_at - 0.1, gain=1.15)

# Opening bell (catches attention softly) and one on the end card.
add(bell(81), 0.05, pan=0.2, gain=1.0)
add(bell(74, 3), 0.05, pan=-0.2, gain=0.5)
add(bell(78), end_at, pan=-0.1, gain=0.9)
add(bell(85, 3.5), end_at + 0.35, pan=0.25, gain=0.45)

# Sparse kalimba melody over the chords (pentatonic, unhurried).
scale = [74, 76, 78, 81, 83, 86]
t = 1.6
while t < end_at - 0.8:
    add(kalimba(int(rng.choice(scale))), t, pan=float(rng.uniform(-0.5, 0.5)), gain=float(rng.uniform(0.6, 0.9)))
    t += float(rng.choice([0.9, 1.2, 1.5, 1.8]))

# Soft room: a synthetic reverb tail.
ir_n = int(2.8 * SR)
tt = np.arange(ir_n) / SR
ir = rng.standard_normal(ir_n) * np.exp(-tt / 0.9)
ir = sosfilt(butter(2, 4000, fs=SR, output="sos"), ir)
ir /= np.sqrt(np.sum(ir ** 2))
wetL = fftconvolve(L, ir)[:N]; wetR = fftconvolve(R, ir[::-1].copy() * 0 + np.roll(ir, 240))[:N]
mixL = 0.75 * L + 0.45 * wetL
mixR = 0.75 * R + 0.45 * wetR
n_out = int(dur * SR)
st = np.stack([mixL[:n_out], mixR[:n_out]], axis=1)
fade = int(1.2 * SR)
st[-fade:] *= np.linspace(1, 0, fade)[:, None]
st[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
st /= np.max(np.abs(st)) * 1.12
wavfile.write(out, SR, (st * 32767).astype(np.int16))
