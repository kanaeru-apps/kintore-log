# アラーム音の WAV を生成する。
#
# これまでアラームは Web Audio API（OfflineAudioContext → Blob URL）で
# 毎回その場で作っていたが、iOS の WKWebView では blob: の再生が不安定で
# 「音が鳴らない」原因になり得た。さらに、ローカル通知の音として使うには
# 実ファイルが必要（UNNotificationSound はファイル名しか受け取れない）。
#
# そこで、js/app.js の schedulePattern() / scheduleTone() が鳴らしていた音を
# そのままオフラインで再現して sounds/*.wav に焼く。パラメータを変えたときは
#     python tools/gen_alarm_wav.py
# を叩き直すこと。
#
# 出力: 22050Hz / 16bit / モノラル（iOS の通知音は最大30秒・リニアPCM）
import math
import struct
import wave
from pathlib import Path

SR = 22050
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sounds"

# schedulePattern(ctx, key, full=true) の full 版と 1:1 で対応させる。
# 各要素: (開始秒, 周波数, 長さ秒, 波形, ピーク音量)
PATTERNS = {}

# beep: 11回 / 0.5秒間隔 / 880Hz と 988Hz を交互
PATTERNS["beep"] = {
    "duration": 5.5,
    "tones": [
        (i * 0.5, 880 if i % 2 == 0 else 988, 0.32, "sine", 0.4)
        for i in range(11)
    ],
}

# bell: 4打 / 1.4秒間隔。1打は基音＋倍音2つの同時発音
_BELL_PARTIALS = [(523.25, 0.5, 1.3), (1046.5, 0.28, 1.0), (1318.5, 0.18, 0.8)]
PATTERNS["bell"] = {
    "duration": 6.0,
    "tones": [
        (i * 1.4, freq, dur, "sine", 0.5 * gain)
        for i in range(4)
        for (freq, gain, dur) in _BELL_PARTIALS
    ],
}

# chime: 3回 / 2.2秒間隔。1回はド・ミ・ソを0.28秒ずらして鳴らす
PATTERNS["chime"] = {
    "duration": 6.0,
    "tones": [
        (i * 2.2 + j * 0.28, freq, 0.6, "triangle", 0.35)
        for i in range(3)
        for j, freq in enumerate([523.25, 659.25, 783.99])
    ],
}

# digital: 22回 / 0.22秒間隔 / 矩形波でピピピ
PATTERNS["digital"] = {
    "duration": 5.0,
    "tones": [
        (i * 0.22, 1318.5 if i % 2 == 0 else 1046.5, 0.11, "square", 0.22)
        for i in range(22)
    ],
}

# soft: 6回 / 0.9秒間隔 / 三角波でやわらかく
PATTERNS["soft"] = {
    "duration": 5.5,
    "tones": [
        (i * 0.9, 440 if i % 2 == 0 else 523.25, 0.7, "triangle", 0.22)
        for i in range(6)
    ],
}


def harmonics(wave_type, freq):
    """波形を倍音の (次数, 振幅) リストにする。
    ナイキスト周波数を超える倍音は折り返しノイズになるので落とす。"""
    if wave_type == "sine":
        return [(1, 1.0)]
    nyquist = SR / 2.0
    out = []
    k = 1
    while freq * k < nyquist:
        if wave_type == "square":
            out.append((k, (4.0 / math.pi) / k))
        else:  # triangle
            sign = 1.0 if ((k - 1) // 2) % 2 == 0 else -1.0
            out.append((k, sign * (8.0 / (math.pi ** 2)) / (k * k)))
        k += 2
    return out


def envelope(t, dur, peak):
    """Web Audio の exponentialRampToValueAtTime を再現する。
    0.0001 → peak（アタック）→ 0.0001（ディケイ）と指数的に動く。"""
    attack = min(0.02, dur * 0.2)
    floor = 0.0001
    if t < 0 or t > dur:
        return 0.0
    if t < attack:
        return floor * ((peak / floor) ** (t / attack))
    return peak * ((floor / peak) ** ((t - attack) / (dur - attack)))


def wave_peak(parts):
    """1周期ぶんを細かく走査して波形の最大振幅を求める。
    Web Audio の OscillatorNode は波形の振幅が ±1 になるように出るので、
    倍音の合計ではなく実際の波形のピークで割らないと、矩形波だけ極端に小さくなる。"""
    top = 0.0
    steps = 2048
    for i in range(steps):
        x = i / steps
        s = 0.0
        for k, amp in parts:
            s += amp * math.sin(2.0 * math.pi * k * x)
        top = max(top, abs(s))
    return top or 1.0


def render(name, spec):
    total = int(SR * spec["duration"])
    buf = [0.0] * total
    for (start, freq, dur, wave_type, peak) in spec["tones"]:
        parts = harmonics(wave_type, freq)
        i0 = int(start * SR)
        n = int(dur * SR)
        norm = wave_peak(parts)
        for i in range(n):
            idx = i0 + i
            if idx >= total:
                break
            t = i / SR
            env = envelope(t, dur, peak)
            if env <= 0.0:
                continue
            phase = 2.0 * math.pi * freq * t
            s = 0.0
            for k, amp in parts:
                s += amp * math.sin(phase * k)
            buf[idx] += (s / norm) * env

    # クリップ防止。全体が 0.9 に収まるよう必要なときだけ縮める
    peak_abs = max(abs(v) for v in buf) if buf else 0.0
    scale = (0.9 / peak_abs) if peak_abs > 0.9 else 1.0

    # 末尾を 5ms でフェードアウトしてプツッというノイズを消す
    fade = int(SR * 0.005)
    frames = bytearray()
    for i, v in enumerate(buf):
        v *= scale
        if i >= total - fade:
            v *= (total - i) / fade
        frames += struct.pack("<h", max(-32767, min(32767, int(v * 32767))))

    path = OUT / (name + ".wav")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))
    print("{:8s} {:5.2f}s  {:>9,} bytes".format(name, spec["duration"], path.stat().st_size))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name in ["beep", "bell", "chime", "digital", "soft"]:
        render(name, PATTERNS[name])
    print("→", OUT)
