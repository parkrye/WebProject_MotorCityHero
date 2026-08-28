"""GIF 원본 에셋을 캔버스에서 쓸 가로 스프라이트시트 PNG로 변환한다.

canvas 의 drawImage 는 애니메이션 GIF 의 프레임을 제어할 수 없으므로
8프레임짜리 GIF 를 가로로 이어붙인 시트 PNG + 메타데이터로 굽는다.

사용법:
    python tools/build_sprites.py <원본_에셋_폴더>

원본 폴더는 통째로 줘도 되고 일부만 줘도 된다. assets/sprites.json 이 이미 있으면
그 위에 이번에 찾은 것만 덮어쓰므로 에셋을 하나씩 추가할 수 있다.

원본 폴더 구조 (전부 선택):
    player_idle.gif / player_walk.gif / player_attack.gif / player_hit.gif
    player_kick.gif / player_clear.gif   없으면 게임이 attack / idle 로 대체한다
    player_jump.gif                      점프. 없으면 게임이 idle 로 대체한다
    player_jumpattack1 / 2 (.gif|.png)   점프 펀치 · 점프 킥. PNG 는 가로 스트립으로 읽는다
    game_bg.png                          스테이지 2(디트로이트) 배경
    bg_stage1.png ... bg_stage6.png      스테이지별 배경. 없는 번호는 game_bg 로 남는다
    illust_clear.png                     스테이지 클리어 연출 일러스트
    buff_frames.png                      가로 8프레임 x 세로 3종(attack/shield/speed) 격자
    enemy/enemy_1.gif ... enemy_7.gif
    sprites/heartIcon.png coin.png ... powerup_attack.png powerup_shield.png powerup_speed.png
    sfx/*.*  bgm/*.*

산출물 (assets/):
    player_*.png, enemy_N_move.png, game_bg.png, bg_stageN.png, buff_*.png
    sprites.json  - 참고용
    sprites.js    - window.SPRITE_MANIFEST. file:// 에서 fetch 가 막히므로 이쪽을 로드한다.
"""

import json
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path

from PIL import Image

FRAME_H = 256  # 세로는 원본 그대로 유지해야 모든 캐릭터의 발 위치가 바닥에 정렬된다
PAD_X = 4      # 좌우 크롭 여유

PLAYER_ANIMS = ("idle", "walk", "attack", "hit")
# 원본이 아직 없으면 게임이 attack / idle 로 대체하므로 없어도 굽기는 성공한다.
PLAYER_OPTIONAL_ANIMS = ("kick", "clear", "jump")
# 파일 이름이 달라도 같은 동작이면 받아준다. 왼쪽이 파일 이름, 오른쪽이 매니페스트 키.
PLAYER_ANIM_ALIASES = {"victory": "clear", "jumpattack1": "jumpAttack", "jumpattack2": "jumpKick"}
# 선택 애니메이션은 GIF 말고 가로 스트립 PNG 로 와도 받는다.
FRAME_SOURCE_EXTS = (".gif", ".png")
ENEMY_COUNT = 7
STAGE_COUNT = 6

ICONS = ("heartIcon", "coin", "healItem", "speaker", "screen",
         "powerup_attack", "powerup_shield", "powerup_speed")
ICON_HEIGHT = 128

# buff_frames.png 는 가로 8프레임 x 세로 3종 격자다. 위에서부터 attack, shield, speed.
BUFF_SHEET = "buff_frames.png"
BUFF_KINDS = ("attack", "shield", "speed")
BUFF_FRAMES = 8
BUFF_SCALE = 0.35  # 캐릭터 뒤에 깔리는 이펙트라 원본 해상도가 필요 없다
BUFF_COLORS = 48

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
    """애니메이션 GIF 는 프레임을, 가로 스트립 PNG 는 정사각 칸을 프레임으로 읽는다."""
    im = Image.open(path)
    count = getattr(im, "n_frames", 1)
    if count > 1:
        frames = []
        for i in range(count):
            im.seek(i)
            frames.append(im.convert("RGBA"))
        return frames

    # 한 장짜리는 가로로 이어붙인 스트립으로 본다. 프레임은 세로 크기와 같은 정사각이다.
    sheet = im.convert("RGBA")
    width = sheet.height
    return [sheet.crop((i * width, 0, (i + 1) * width, sheet.height))
            for i in range(max(1, sheet.width // width))]


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


def bake(name, frame_groups, out_dir, x_range=None):
    """한 캐릭터의 애니메이션들을 공통 x 크롭으로 시트화한다.

    x_range 를 주면 그 범위로 자른다. 이미 구운 시트에 애니메이션만 덧붙일 때
    크롭이 달라지면 애니메이션이 바뀔 때마다 캐릭터가 좌우로 떨린다.
    """
    x0, x1 = x_range or union_x_range(list(frame_groups.values()))
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


def union_bbox(images):
    """여러 프레임을 모두 덮는 bbox. 프레임마다 따로 자르면 이펙트가 떨린다."""
    left = top = right = bottom = None
    for image in images:
        box = image.getchannel("A").getbbox()
        if box is None:
            continue
        left = box[0] if left is None else min(left, box[0])
        top = box[1] if top is None else min(top, box[1])
        right = box[2] if right is None else max(right, box[2])
        bottom = box[3] if bottom is None else max(bottom, box[3])
    if left is None:
        return (0, 0, images[0].width, images[0].height)
    return (left, top, right, bottom)


def bake_background(path, out_dir, name):
    """배경·일러스트는 캔버스 크기로 늘려 그려지므로 원본 해상도가 필요 없다."""
    image = Image.open(path).convert("RGB").resize(BG_SIZE, Image.LANCZOS)
    size = save_quantized(image, out_dir / name, BG_COLORS)
    print("  %s  %dx%d  (%dKB)" % (name, image.width, image.height, size // 1024))
    return name


def bake_buff(path, out_dir):
    """8프레임 x 3종 격자를 종류별 가로 시트로 나눈다."""
    sheet = Image.open(path).convert("RGBA")
    cell_w = sheet.width / BUFF_FRAMES
    cell_h = sheet.height / len(BUFF_KINDS)

    baked = {}
    for row, kind in enumerate(BUFF_KINDS):
        top, bottom = round(row * cell_h), round((row + 1) * cell_h)
        cells = [sheet.crop((round(i * cell_w), top, round((i + 1) * cell_w), bottom))
                 for i in range(BUFF_FRAMES)]

        box = union_bbox(cells)
        cells = [cell.crop(box) for cell in cells]
        frame_w, frame_h = cells[0].size

        strip = Image.new("RGBA", (frame_w * BUFF_FRAMES, frame_h))
        for i, cell in enumerate(cells):
            strip.paste(cell, (i * frame_w, 0))

        small_w = max(1, round(frame_w * BUFF_SCALE))
        small = strip.resize((small_w * BUFF_FRAMES, max(1, round(frame_h * BUFF_SCALE))), Image.LANCZOS)

        out = out_dir / ("buff_" + kind + ".png")
        size = save_quantized(small, out, BUFF_COLORS)
        # 크기는 스프라이트와 같은 규칙으로 원본 기준을 남긴다.
        baked[kind] = {"file": out.name, "frames": BUFF_FRAMES,
                       "frameWidth": frame_w, "frameHeight": frame_h}
        print("  %s  %dx%d  (%df, %dKB)" % (out.name, small.width, small.height, BUFF_FRAMES, size // 1024))
    return baked


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
            bitrate = BGM_BITRATE if kind == "bgm" else SFX_BITRATE
            for path in sorted(source.iterdir()):
                if path.suffix.lower() not in AUDIO_EXTS:
                    continue
                stem = normalize_stem(path.stem)
                stem = AUDIO_RENAME[kind].get(stem, stem)
                # 확장자가 다른 같은 곡이 남아 중복되지 않도록 먼저 지운다.
                for old in target.glob(stem + ".*"):
                    if old.suffix.lower() in AUDIO_EXTS:
                        old.unlink()
                encode_audio(path, target / (stem + ".mp3"), bitrate)

        found = {camel(p.stem): kind + "/" + p.name
                 for p in sorted(target.iterdir()) if p.suffix.lower() in AUDIO_EXTS}
        manifest[kind] = found
        print("  %s: %s" % (kind, ", ".join(found) if found else "(없음)"))

    return manifest


def find_player_gifs(src, name):
    """<src>/<name>/ 를 먼저 보고, 없으면 <src> 바로 아래에서 찾는다."""
    for base in (src / name, src):
        paths = {a: base / (name + "_" + a + ".gif") for a in PLAYER_ANIMS}
        if all(p.exists() for p in paths.values()):
            return paths
    return None


def find_optional_frames(src):
    """선택 애니메이션. player_victory.gif 처럼 이름이 다른 별칭도 받는다."""
    wanted = dict(PLAYER_ANIM_ALIASES)
    wanted.update({a: a for a in PLAYER_OPTIONAL_ANIMS})

    found = {}
    for base in (src / "player", src):
        for stem, anim in wanted.items():
            for ext in FRAME_SOURCE_EXTS:
                path = base / ("player_%s%s" % (stem, ext))
                if anim not in found and path.exists():
                    found[anim] = path
    return found


def strip_checker_background(icon):
    """투명 표시용 체커보드가 픽셀로 그려진 이미지의 배경을 실제 투명으로 바꾼다.

    가장자리에서 시작해 "밝은 무채색"으로 이어진 부분만 지운다. 아이콘 안쪽의
    흰색 하이라이트는 가장자리와 이어져 있지 않으므로 그대로 남는다.
    이미 투명한 부분이 있는 이미지는 손대지 않는다.
    """
    if icon.getchannel("A").getextrema()[0] < 255:
        return icon

    width, height = icon.size
    pixels = icon.load()

    def is_background(xy):
        r, g, b, _ = pixels[xy]
        return max(r, g, b) - min(r, g, b) < 14 and min(r, g, b) > 222

    seen = bytearray(width * height)
    queue = deque()

    def seed(x, y):
        if not seen[y * width + x] and is_background((x, y)):
            seen[y * width + x] = 1
            queue.append((x, y))

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)
    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    if not queue:
        return icon

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    seed(nx, ny)

    return icon


def find_icon(src, name):
    """<src>/sprites/<name>.png 를 먼저 보고, 없으면 <src> 바로 아래에서 찾는다."""
    for base in (src / "sprites", src):
        path = base / (name + ".png")
        if path.exists():
            return path
    return None


def bake_icon(path, out_dir):
    """아이콘은 여백을 잘라내고 높이 기준으로 줄여서 저장한다."""
    icon = strip_checker_background(Image.open(path).convert("RGBA"))
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

    # 이미 구운 매니페스트가 있으면 그 위에 이번에 찾은 것만 덮어쓴다.
    # 에셋이 한 번에 다 오지 않으므로 부분 굽기를 기본으로 둔다.
    manifest_path = out_dir / "sprites.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if manifest:
        print("기존 매니페스트 위에 덮어쓴다: %s" % manifest_path.name)
        print()
    manifest.setdefault("enemies", {})
    manifest.setdefault("background", "game_bg.png")

    print("player:")
    paths = find_player_gifs(src, "player")
    extra = find_optional_frames(src)

    if paths is not None:
        groups = {a: load_frames(path) for a, path in {**paths, **extra}.items()}
        manifest["player"] = bake("player", groups, out_dir)
    elif extra and manifest.get("player"):
        # 시트 전체를 다시 구울 원본이 없으므로 기존 크롭 범위 그대로 애니메이션만 덧붙인다.
        base = manifest["player"]
        x0 = round(FRAME_H / 2 - base["anchorX"])
        groups = {a: load_frames(path) for a, path in extra.items()}
        added = bake("player", groups, out_dir, (x0, x0 + base["frameWidth"]))
        base["anims"].update(added["anims"])
    else:
        print("  skip (원본 없음)")

    if not manifest.get("player"):
        sys.exit("player_*.gif 도 기존 매니페스트도 없습니다: " + str(src))

    print("enemies:")
    for i in range(1, ENEMY_COUNT + 1):
        gif = src / "enemy" / ("enemy_%d.gif" % i)
        if not gif.exists():
            print("  skip enemy_%d (없음)" % i)
            continue
        manifest["enemies"][str(i)] = bake("enemy_%d" % i, {"move": load_frames(gif)}, out_dir)

    print("backgrounds:")
    manifest.setdefault("backgroundSize", list(BG_SIZE))
    if (src / "game_bg.png").exists():
        bake_background(src / "game_bg.png", out_dir, "game_bg.png")

    # 스테이지 2(디트로이트)는 원래 배경을 그대로 쓴다. 없는 번호도 같은 폴백을 둔다.
    stages = manifest.setdefault("stageBackgrounds", {})
    for i in range(1, STAGE_COUNT + 1):
        path = src / ("bg_stage%d.png" % i)
        if path.exists():
            stages[str(i)] = bake_background(path, out_dir, "bg_stage%d.png" % i)
        else:
            stages.setdefault(str(i), manifest["background"])

    illustrations = manifest.setdefault("illustrations", {})
    for key, filename in (("clear", "illust_clear.png"),):
        if (src / filename).exists():
            illustrations[key] = bake_background(src / filename, out_dir, filename)

    if (src / BUFF_SHEET).exists():
        print("buffs:")
        manifest["buffs"] = bake_buff(src / BUFF_SHEET, out_dir)

    found = {}
    for name in ICONS:
        path = find_icon(src, name)
        if path is not None:
            found[name] = path
    if found:
        print("icons:")
        icons = manifest.setdefault("icons", {})
        icons.update({name: bake_icon(path, out_dir) for name, path in found.items()})

    font = find_icon(src, "font")
    if font is not None:
        print("font:")
        manifest["font"] = bake_font(font, out_dir)

    print("audio:")
    manifest["audio"] = collect_audio(src, out_dir)

    body = json.dumps(manifest, indent=2)
    manifest_path.write_text(body, encoding="utf-8")

    # file:// 로 열었을 때 fetch 는 CORS 로 막히므로 JS 전역으로도 굽는다
    js = "// build_sprites.py 가 생성한 파일. 직접 수정하지 말 것.\nwindow.SPRITE_MANIFEST = " + body + ";\n"
    (out_dir / "sprites.js").write_text(js, encoding="utf-8")

    print("\n-> " + str(manifest_path))
    print("-> " + str(out_dir / "sprites.js"))


if __name__ == "__main__":
    main()
