"""GIF 원본 에셋을 캔버스에서 쓸 가로 스프라이트시트 PNG로 변환한다.

canvas 의 drawImage 는 애니메이션 GIF 의 프레임을 제어할 수 없으므로
8프레임짜리 GIF 를 가로로 이어붙인 시트 PNG + 메타데이터로 굽는다.

사용법:
    python tools/build_sprites.py <원본_에셋_폴더>

원본 폴더 구조:
    player_idle.gif / player_walk.gif / player_attack.gif / player_hit.gif
    player2/player2_idle.gif ... (선택. 없으면 2P 는 1P 스프라이트를 색조만 바꿔 쓴다)
    game_bg.png
    enemy/enemy_1.gif ... enemy_6.gif

산출물 (assets/):
    player_*.png, player2_*.png, enemy_N_move.png, game_bg.png
    sprites.json  - 참고용
    sprites.js    - window.SPRITE_MANIFEST. file:// 에서 fetch 가 막히므로 이쪽을 로드한다.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

FRAME_H = 256  # 세로는 원본 그대로 유지해야 모든 캐릭터의 발 위치가 바닥에 정렬된다
PAD_X = 4      # 좌우 크롭 여유

PLAYER_ANIMS = ("idle", "walk", "attack", "hit")
ENEMY_COUNT = 6

ICONS = ("heartIcon", "coin", "healItem")
ICON_HEIGHT = 128

# ── 용량 최적화 ────────────────────────────────────────────────────────────
# 시트 PNG 를 논리 크기보다 작게 굽고 게임에서 확대해 그린다.
# 도트가 굵어져 오히려 레트로해지고 용량은 배율의 제곱만큼 줄어든다.
# 크기 정보는 매니페스트에 원본(논리) 기준으로 남으므로 게임 좌표는 그대로다.
SPRITE_SCALE = 0.5
SPRITE_COLORS = 64   # 팔레트 색 수. 줄일수록 작아지고 색 띠가 두드러진다
ICON_COLORS = 48
BG_SIZE = (512, 384) # 배경은 캔버스(1024x768)의 절반으로 굽는다
BG_COLORS = 64
FONT_COLORS = 32     # 글자에 그라데이션이 있어 너무 줄이면 뭉개진다

# 오디오는 모노 · 저샘플레이트로 다시 인코딩한다. 원본은 48kHz 스테레오라 과하다.
AUDIO_SAMPLE_RATE = 22050
BGM_BITRATE = "48k"
SFX_BITRATE = "64k"

# 글리프는 6x6 으로 배치되어 있고 알파가 비어있는 구간으로 칸을 찾는다.
FONT_ORDER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
FONT_ROWS = 6
FONT_COLUMNS = 6
FONT_HEIGHT = 64   # 가장 큰 글리프를 이 높이로 맞춘다 (게임에서 확대해 그린다)
FONT_PADDING = 2   # 스트립에서 옆 글리프가 번지지 않도록
ALPHA_THRESHOLD = 16


def shrink(image, scale):
    """LANCZOS 로 곱게 줄인다. 게임에서 다시 확대할 때 pixelated 로 그려 도트가 살아난다."""
    if scale >= 1:
        return image
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


def save_quantized(image, path, colors):
    """팔레트 PNG 로 저장한다. 투명도가 있으면 팔레트에 알파를 포함하는 방식을 쓴다."""
    if image.mode == "RGBA":
        # MEDIANCUT 은 알파를 다루지 못한다. FASTOCTREE 만 RGBA 를 받는다.
        image = image.quantize(colors=colors, method=Image.FASTOCTREE)
    else:
        image = image.convert("RGB").quantize(colors=colors, method=Image.MEDIANCUT)

    image.save(path, optimize=True)
    return path.stat().st_size


def load_frames(path):
    im = Image.open(path)
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append(im.convert("RGBA"))
    return frames


def union_x_range(frame_groups):
    """여러 애니메이션의 모든 프레임을 덮는 x 범위. 애니메이션 전환 시 떨림 방지."""
    left = right = None
    for frames in frame_groups:
        for f in frames:
            box = f.getchannel("A").getbbox()
            if box is None:
                continue
            left = box[0] if left is None else min(left, box[0])
            right = box[2] if right is None else max(right, box[2])
    if left is None:
        return 0, FRAME_H
    return max(0, left - PAD_X), min(FRAME_H, right + PAD_X)


def bake(name, frame_groups, out_dir):
    """한 캐릭터의 애니메이션들을 공통 x 크롭으로 시트화한다."""
    x0, x1 = union_x_range(list(frame_groups.values()))
    width = x1 - x0

    anims = {}
    for anim, frames in frame_groups.items():
        sheet = Image.new("RGBA", (width * len(frames), FRAME_H))
        for i, frame in enumerate(frames):
            sheet.paste(frame.crop((x0, 0, x1, FRAME_H)), (i * width, 0))

        # 프레임 경계가 어긋나지 않도록 프레임 폭이 정수가 되게 맞춰 줄인다.
        small_frame_w = max(1, round(width * SPRITE_SCALE))
        small = sheet.resize(
            (small_frame_w * len(frames), max(1, round(FRAME_H * SPRITE_SCALE))), Image.LANCZOS
        )

        out = out_dir / (name + "_" + anim + ".png")
        size = save_quantized(small, out, SPRITE_COLORS)
        anims[anim] = {"file": out.name, "frames": len(frames)}
        print("  %s  %dx%d  (%df, %dKB)" % (out.name, small.width, small.height, len(frames), size // 1024))

    return {
        # 크기는 원본 기준으로 남긴다. 게임은 이 크기로 그리고 시트만 확대된다.
        "frameWidth": width,
        "frameHeight": FRAME_H,
        # 캐릭터 좌우 중심이 크롭 후 프레임 안에서 어디인지 (원본 256 기준 중앙)
        "anchorX": (FRAME_H / 2) - x0,
        "anims": anims,
    }


AUDIO_EXTS = (".wav", ".mp3", ".ogg", ".flac", ".m4a")
AUDIO_DIRS = ("sfx", "bgm")

# 게임이 부르는 이름으로 맞춰준다. 원본 파일명이 뭐든 여기서 정리한다.
AUDIO_RENAME = {
    "bgm": {"main": "game", "game_over": "gameover", "stage": "game", "title": "lobby"},
    "sfx": {},
}


def encode_audio(source, target, bitrate):
    """모노 · 저샘플레이트 mp3 로 다시 굽는다. ffmpeg 이 없으면 원본을 그대로 복사한다."""
    if shutil.which("ffmpeg") is None:
        fallback = target.with_suffix(source.suffix.lower())
        shutil.copyfile(source, fallback)
        print("    %s  (ffmpeg 이 없어 원본 그대로)" % fallback.name)
        return fallback

    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
         "-ac", "1", "-ar", str(AUDIO_SAMPLE_RATE), "-b:a", bitrate,
         "-map_metadata", "-1", str(target)],
        check=True,
    )
    before = source.stat().st_size // 1024
    after = target.stat().st_size // 1024
    print("    %-16s %5dKB -> %4dKB" % (target.name, before, after))
    return target


def normalize_stem(stem):
    """'game over' -> 'game_over'. 공백이 든 파일명은 URL 에서 성가시다."""
    return "_".join(stem.lower().split())


def camel(stem):
    """enemy_die -> enemyDie. JS 쪽에서 그대로 쓰기 편한 키로 바꾼다."""
    head, *rest = stem.split("_")
    return head + "".join(part.capitalize() for part in rest)


def collect_audio(src, out_dir):
    """원본 폴더의 sfx/bgm 을 assets 로 복사하고, 최종적으로 있는 파일만 매니페스트에 담는다.

    없는 파일을 게임이 요청하면 404 가 나므로 실제로 존재하는 것만 목록에 넣는다.
    BGM 은 나중에 assets/bgm 에 직접 넣고 이 스크립트를 다시 돌리면 잡힌다.
    """
    manifest = {}
    for kind in AUDIO_DIRS:
        target = out_dir / kind
        target.mkdir(exist_ok=True)

        source = src / kind
        if source.is_dir():
            # 이름 규칙이 바뀌면 옛 파일이 남아 중복되므로 먼저 비운다.
            for old in target.iterdir():
                if old.suffix.lower() in AUDIO_EXTS:
                    old.unlink()

            bitrate = BGM_BITRATE if kind == "bgm" else SFX_BITRATE
            for path in sorted(source.iterdir()):
                if path.suffix.lower() not in AUDIO_EXTS:
                    continue
                stem = normalize_stem(path.stem)
                stem = AUDIO_RENAME[kind].get(stem, stem)
                encode_audio(path, target / (stem + ".mp3"), bitrate)

        found = {camel(p.stem): kind + "/" + p.name
                 for p in sorted(target.iterdir()) if p.suffix.lower() in AUDIO_EXTS}
        manifest[kind] = found
        print("  %s: %s" % (kind, ", ".join(found) if found else "(없음)"))

    return manifest


def find_player_gifs(src, name):
    """<src>/<name>/ 를 먼저 보고, 없으면 <src> 바로 아래에서 찾는다.

    2P 원본은 보통 폴더째 받으므로 두 배치를 모두 받아준다.
    """
    for base in (src / name, src):
        paths = {a: base / (name + "_" + a + ".gif") for a in PLAYER_ANIMS}
        if all(p.exists() for p in paths.values()):
            return paths
    return None


def bake_icon(path, out_dir):
    """아이콘은 여백을 잘라내고 높이 기준으로 줄여서 저장한다."""
    icon = Image.open(path).convert("RGBA")
    box = icon.getchannel("A").getbbox()
    icon = icon.crop(box)

    scale = ICON_HEIGHT / icon.height
    icon = icon.resize((max(1, round(icon.width * scale)), ICON_HEIGHT), Image.LANCZOS)

    # 아이콘 크기는 픽업 히트박스 계산에 쓰이므로 줄이지 않고 색만 줄인다.
    out = out_dir / path.name
    size = save_quantized(icon, out, ICON_COLORS)
    print("  %s  %dx%d  (%dKB)" % (out.name, icon.width, icon.height, size // 1024))
    return {"file": out.name, "width": icon.width, "height": icon.height}


def alpha_bands(mask, axis):
    """알파가 비어있는 구간으로 끊어 글리프 행/열 밴드를 찾는다.

    폰트 시트의 칸 폭이 균일하지 않아 6등분으로는 정확히 잘리지 않는다.
    """
    counts = [0] * mask.size[1 - axis]
    pixels = mask.load()
    width, height = mask.size
    for y in range(height):
        for x in range(width):
            if pixels[x, y] > ALPHA_THRESHOLD:
                counts[x if axis == 0 else y] += 1

    bands = []
    start = None
    for i, value in enumerate(counts):
        if value > 0 and start is None:
            start = i
        elif value == 0 and start is not None:
            bands.append((start, i))
            start = None
    if start is not None:
        bands.append((start, len(counts)))
    return bands


def bake_font(path, out_dir):
    """6x6 로 배치된 글리프를 잘라 가로 스트립 한 장 + 글리프별 메트릭으로 만든다."""
    sheet = Image.open(path).convert("RGBA")
    mask = sheet.getchannel("A")

    cols = alpha_bands(mask, axis=0)
    rows = alpha_bands(mask, axis=1)
    if len(cols) != FONT_COLUMNS or len(rows) != FONT_ROWS:
        raise SystemExit(
            "폰트 격자 검출 실패: 열 %d개, 행 %d개 (기대: %dx%d)"
            % (len(cols), len(rows), FONT_COLUMNS, FONT_ROWS)
        )

    # 각 글리프를 자기 칸 안에서 다시 타이트하게 자른다.
    glyphs = []
    for index, char in enumerate(FONT_ORDER):
        row, col = divmod(index, FONT_COLUMNS)
        x0, x1 = cols[col]
        y0, y1 = rows[row]
        cell = sheet.crop((x0, y0, x1, y1))
        box = cell.getchannel("A").getbbox()
        glyphs.append((char, cell.crop(box)))

    # 모든 글리프가 칸 위쪽에 정렬되어 있으므로 위 기준으로 맞추면 된다.
    ref_height = max(image.height for _, image in glyphs)
    scale = FONT_HEIGHT / ref_height

    sized = [
        (char, image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS))
        for char, image in glyphs
    ]

    strip_width = sum(image.width + FONT_PADDING for _, image in sized) - FONT_PADDING
    strip = Image.new("RGBA", (strip_width, FONT_HEIGHT))

    metrics = {}
    x = 0
    for char, image in sized:
        strip.paste(image, (x, 0))
        metrics[char] = {"x": x, "width": image.width, "height": image.height}
        x += image.width + FONT_PADDING

    out = out_dir / "font.png"
    size = save_quantized(strip, out, FONT_COLORS)
    print("  %s  %dx%d  (%d glyphs, %dKB)" % (out.name, strip.width, strip.height, len(metrics), size // 1024))

    return {"file": out.name, "refHeight": FONT_HEIGHT, "glyphs": metrics}


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python tools/build_sprites.py <원본_에셋_폴더>")

    src = Path(sys.argv[1])
    out_dir = Path(__file__).resolve().parent.parent / "assets"
    out_dir.mkdir(exist_ok=True)

    manifest = {"player": None, "enemies": {}, "background": "game_bg.png"}

    print("player:")
    paths = find_player_gifs(src, "player")
    if paths is None:
        sys.exit("player_*.gif 를 찾지 못했습니다: " + str(src))
    manifest["player"] = bake("player", {a: load_frames(p) for a, p in paths.items()}, out_dir)

    # 2P 는 선택 사항. 없으면 게임이 1P 시트를 색조만 바꿔서 쓴다.
    print("player2:")
    paths = find_player_gifs(src, "player2")
    if paths is None:
        print("  skip (player2_*.gif 없음. 2P 는 색조 폴백으로 그려진다)")
    else:
        manifest["player2"] = bake("player2", {a: load_frames(p) for a, p in paths.items()}, out_dir)

    print("enemies:")
    for i in range(1, ENEMY_COUNT + 1):
        gif = src / "enemy" / ("enemy_%d.gif" % i)
        if not gif.exists():
            print("  skip enemy_%d (없음)" % i)
            continue
        manifest["enemies"][str(i)] = bake("enemy_%d" % i, {"move": load_frames(gif)}, out_dir)

    # 배경은 캔버스 크기로 늘려 그려지므로 원본 해상도가 필요 없다.
    bg = Image.open(src / "game_bg.png").convert("RGB").resize(BG_SIZE, Image.LANCZOS)
    size = save_quantized(bg, out_dir / "game_bg.png", BG_COLORS)
    manifest["backgroundSize"] = [bg.width, bg.height]
    print("background: game_bg.png  %dx%d  (%dKB)" % (bg.width, bg.height, size // 1024))

    sprites = src / "sprites"
    if sprites.is_dir():
        print("icons:")
        manifest["icons"] = {name: bake_icon(sprites / (name + ".png"), out_dir) for name in ICONS}
        print("font:")
        manifest["font"] = bake_font(sprites / "font.png", out_dir)

    print("audio:")
    manifest["audio"] = collect_audio(src, out_dir)

    body = json.dumps(manifest, indent=2)
    (out_dir / "sprites.json").write_text(body, encoding="utf-8")

    # file:// 로 열었을 때 fetch 는 CORS 로 막히므로 JS 전역으로도 굽는다
    js = "// build_sprites.py 가 생성한 파일. 직접 수정하지 말 것.\nwindow.SPRITE_MANIFEST = " + body + ";\n"
    (out_dir / "sprites.js").write_text(js, encoding="utf-8")

    print("\n-> " + str(out_dir / "sprites.json"))
    print("-> " + str(out_dir / "sprites.js"))


if __name__ == "__main__":
    main()
