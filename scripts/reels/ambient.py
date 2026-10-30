"""Original long, slow meditative music for Back's calm videos (5-20 minutes) and their Shorts.
Same family as music.py (the Reels sound): warm detuned pads, soft felt piano / kalimba / bells, a room reverb,
but built for listening a long time: chords last 10-14 seconds and melt into each other, the melody comes in short
phrases with long rests, and the density breathes slowly over the piece so it never feels like a loop.
Fully synthesized (no samples, no licensed tracks).

usage: ambient.py OUT.wav DURATION [SEED] [MOOD] [END_AT]
MOOD: warm, night, airy, piano. END_AT (optional): a soft resolving chord and bell from that second (the end card).
"""
import sys
import numpy as np
from scipy.signal import oaconvolve, butter, sosfilt

SR = 44100
out = sys.argv[1]
dur = float(sys.argv[2])
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
mood = sys.argv[4] if len(sys.argv) > 4 else "night"
end_at = float(sys.argv[5]) if len(sys.argv) > 5 else None
rng = np.random.default_rng(seed)
N = int(SR * (dur + 6))
L = np.zeros(N, dtype=np.float32)
R = np.zeros(N, dtype=np.float32)

# Progressions of eight chords (MIDI), low root for the drone, a pentatonic scale for the melody.
MOODS = {
    "warm": dict(prog=[[50, 57, 62, 64, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 62], [45, 52, 57, 61, 64],
                       [50, 57, 61, 66, 69], [43, 50, 54, 59, 62], [40, 47, 55, 59, 62], [45, 52, 57, 59, 64]],
                 root=38, scale=[66, 69, 71, 74, 76, 78, 81], inst="kalimba", cutoff=1700, chord=(11, 14)),
    "night": dict(prog=[[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [36, 43, 52, 55, 59], [43, 50, 55, 59, 62],
                        [45, 52, 55, 60, 64], [38, 45, 53, 57, 60], [41, 48, 55, 57, 64], [40, 47, 52, 56, 59]],
                  root=33, scale=[64, 67, 69, 71, 72, 74, 76], inst="felt", cutoff=1100, chord=(12, 15)),
    "airy": dict(prog=[[52, 59, 64, 66, 71], [49, 56, 61, 64, 68], [45, 52, 57, 61, 64], [47, 54, 59, 63, 66],
                       [52, 59, 63, 68, 71], [44, 51, 56, 59, 63], [45, 52, 59, 61, 66], [47, 54, 59, 61, 66]],
                 root=40, scale=[71, 73, 76, 78, 80, 83, 85], inst="bell", cutoff=2300, chord=(10, 13)),
    "piano": dict(prog=[[48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 64], [43, 50, 55, 59, 62],
                        [48, 55, 59, 64, 67], [40, 47, 55, 59, 64], [41, 48, 57, 60, 65], [43, 50, 55, 57, 62]],
                  root=36, scale=[64, 67, 69, 72, 74, 76, 79], inst="piano", cutoff=1500, chord=(11, 14)),
}
M = MOODS.get(mood, MOODS["night"])


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N or i < 0:
        return
    j = min(N, i + len(sig))
    s = (sig[: j - i] * gain).astype(np.float32)
    L[i:j] += s * np.float32(np.sqrt(0.5 * (1 - pan)))
    R[i:j] += s * np.float32(np.sqrt(0.5 * (1 + pan)))


LP = {}


def lowpass(s, f):
    if f not in LP:
        LP[f] = butter(2, f, fs=SR, output="sos")
    return sosfilt(LP[f], s)


def pad(notes, length, attack=3.5, release=5.0):
    """A soft chorused pad; each voice breathes a little on its own so the chord is alive."""
    n = int((length + release) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, m in enumerate(notes):
        f = hz(m)
        breath = 0.75 + 0.25 * np.sin(2 * np.pi * (0.05 + 0.017 * k) * t + rng.uniform(0, 6.28))
        for det in (-0.09, 0.09):
            ff = f * 2 ** (det / 12)
            ph = rng.uniform(0, 6.28)
            s += breath * (np.sin(2 * np.pi * ff * t + ph) + 0.22 * np.sin(4 * np.pi * ff * t + ph) + 0.06 * np.sin(6 * np.pi * ff * t + ph))
    e = np.minimum(1, t / attack) ** 1.5
    e *= np.clip(1 - (t - length) / release, 0, 1) ** 2
    return lowpass(s * e, M["cutoff"]) / (len(notes) * 4.5)


def bell(m, length=6.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.zeros(n)
    for ratio, amp, dec in ((1, 1, 3.5), (2.76, 0.4, 1.8), (5.4, 0.15, 0.9), (8.93, 0.05, 0.5)):
        s += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / dec)
    return s * np.minimum(1, t / 0.006) * 0.3


def kalimba(m, length=3.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 3.0 * f * t) * np.exp(-t / 0.08)) * np.exp(-t / 0.9)
    return s * np.minimum(1, t / 0.004) * 0.26


def piano(m, length=5.0, felt=False):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.zeros(n)
    partials = ((1, 1.0, 2.2), (2, 0.32, 1.1), (3, 0.1, 0.6), (4, 0.04, 0.35)) if felt else ((1, 1.0, 1.8), (2, 0.45, 1.0), (3, 0.2, 0.55), (4, 0.09, 0.35), (5, 0.04, 0.22))
    for k, amp, dec in partials:
        fk = f * k * (1 + 0.0004 * k * k)
        s += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t / dec)
    s *= np.minimum(1, t / (0.015 if felt else 0.005))
    if felt:
        s = lowpass(s, 1500)
    return s * 0.22


def note(m):
    inst = M["inst"]
    if inst == "kalimba":
        return kalimba(m)
    if inst == "bell":
        return bell(m, 4.0) * 0.5
    return piano(m, felt=(inst == "felt"))


music_end = end_at if end_at else dur
# Density breathes over the piece: a slow curve (0.25..1) so some minutes are almost only pads.
breath_period = rng.uniform(150, 220)
breath_phase = rng.uniform(0, 6.28)


def density(t):
    return 0.25 + 0.75 * (0.5 + 0.5 * np.sin(2 * np.pi * t / breath_period + breath_phase))


# 1. Low drone on the root, very quiet, the floor everything stands on.
nd = int((music_end + 4) * SR)
td = np.arange(nd) / SR
drone = (np.sin(2 * np.pi * hz(M["root"]) * td) + 0.4 * np.sin(2 * np.pi * hz(M["root"] + 7) * td)) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.021 * td))
drone *= np.minimum(1, td / 8) * np.clip((music_end + 4 - td) / 6, 0, 1)
add(lowpass(drone, 400) * 0.05, 0)
del drone, td

# 2. Chords, melting into each other. The progression is walked with small surprises, never the same 8 in a row.
prog = M["prog"]
t = 0.0
k = int(rng.integers(0, len(prog)))
lo, hi = M["chord"]
while t < music_end - 2:
    length = float(rng.uniform(lo, hi))
    if end_at and t + length > end_at:
        length = max(3.0, end_at - t)
    add(pad(prog[k % len(prog)], length + 1.5), t, pan=float(rng.uniform(-0.25, 0.25)), gain=1.0)

    # 3. A short melodic phrase over some chords (more often when the piece "breathes in").
    if t > 4 and rng.random() < 0.65 * density(t):
        scale = M["scale"]
        idx = int(rng.integers(1, len(scale) - 1))
        nt = t + float(rng.uniform(1.0, 3.0))
        for _ in range(int(rng.integers(2, 6))):
            if nt > min(music_end - 3, t + length):
                break
            idx = int(np.clip(idx + rng.choice([-2, -1, -1, 0, 1, 1, 2]), 0, len(scale) - 1))
            add(note(scale[idx]), nt, pan=float(rng.uniform(-0.45, 0.45)), gain=float(rng.uniform(0.5, 0.8)))
            nt += float(rng.choice([1.2, 1.6, 2.0, 2.6]))
        # A quiet echo an octave up, like a reflection.
        if rng.random() < 0.35:
            add(note(scale[idx] + 12), nt + 0.4, pan=float(rng.uniform(-0.6, 0.6)), gain=0.25)

    # 4. Now and then a soft high bell.
    if rng.random() < 0.18:
        add(bell(M["scale"][int(rng.integers(2, len(M["scale"])))] + 12), t + float(rng.uniform(0, length)), pan=float(rng.uniform(-0.6, 0.6)), gain=0.35)

    t += length
    k += int(rng.choice([1, 1, 1, 2, -1]))

# 5. The end: a resolving chord and a bell (on the end card of a Short, or the last seconds of a long video).
if end_at:
    first = prog[0]
    add(pad(first, max(2.0, dur - end_at), attack=1.2, release=3.0), end_at - 0.2, gain=1.2)
    add(bell(M["scale"][-1]), end_at, pan=-0.1, gain=0.8)
    add(bell(M["scale"][2] + 12, 4.5), end_at + 0.4, pan=0.25, gain=0.4)

# 6. Room: a long, dark reverb tail (overlap-add, so twenty minutes fit in memory).
ir_n = int(4.0 * SR)
tt = np.arange(ir_n) / SR
ir = rng.standard_normal(ir_n) * np.exp(-tt / (1.6 if mood == "night" else 1.3))
ir = lowpass(ir, 3500)
ir /= np.sqrt(np.sum(ir ** 2))
ir = ir.astype(np.float32)
wetL = oaconvolve(L, ir)[:N]
wetR = oaconvolve(R, np.roll(ir, 300))[:N]
n_out = int(dur * SR)
st = np.stack([0.7 * L[:n_out] + 0.55 * wetL[:n_out], 0.7 * R[:n_out] + 0.55 * wetR[:n_out]], axis=1)
del wetL, wetR
st[:, 0] = lowpass(st[:, 0], 6000)
st[:, 1] = lowpass(st[:, 1], 6000)
fi = int(min(4.0, dur / 6) * SR)
fo = int(min(6.0, dur / 5) * SR)
st[:fi] *= np.linspace(0, 1, fi)[:, None]
st[-fo:] *= np.linspace(1, 0, fo)[:, None]
st /= np.max(np.abs(st)) * 1.12
import wave
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
