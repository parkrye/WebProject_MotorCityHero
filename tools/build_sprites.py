"""GIF 원본 에셋을 캔버스에서 쓸 가로 스프라이트시트 PNG로 변환한다.

canvas 의 drawImage 는 애니메이션 GIF 의 프레임을 제어할 수 없으므로
8프레임짜리 GIF 를 가로로 이어붙인 시트 PNG + 메타데이터로 굽는다.

사용법:
    python tools/build_sprites.py <원본_에셋_폴더>

원본 폴더 구조:
    player_idle.gif / player_walk.gif / player_attack.gif / player_hit.gif
    game_bg.png
    enemy/enemy_1.gif ... enemy_6.gif

산출물 (assets/):
    player_*.png, enemy_N_move.png, game_bg.png
    sprites.json  - 참고용
    sprites.js    - window.SPRITE_MANIFEST. file:// 에서 fetch 가 막히므로 이쪽을 로드한다.
"""

import json
import sys
from pathlib import Path

from PIL import Image

FRAME_H = 256  # 세로는 원본 그대로 유지해야 모든 캐릭터의 발 위치가 바닥에 정렬된다
PAD_X = 4      # 좌우 크롭 여유

PLAYER_ANIMS = ("idle", "walk", "attack", "hit")
ENEMY_COUNT = 6

ICONS = ("heartIcon", "coin", "healItem")
ICON_HEIGHT = 128

# 글리프는 6x6 으로 배치되어 있고 알파가 비어있는 구간으로 칸을 찾는다.
FONT_ORDER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
FONT_ROWS = 6
FONT_COLUMNS = 6
FONT_HEIGHT = 128  # 가장 큰 글리프를 이 높이로 맞춘다
FONT_PADDING = 2   # 스트립에서 옆 글리프가 번지지 않도록
ALPHA_THRESHOLD = 16


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
        out = out_dir / (name + "_" + anim + ".png")
        sheet.save(out, optimize=True)
        anims[anim] = {"file": out.name, "frames": len(frames)}
        print("  %s  %dx%d  (%df)" % (out.name, sheet.width, sheet.height, len(frames)))

    return {
        "frameWidth": width,
        "frameHeight": FRAME_H,
        # 캐릭터 좌우 중심이 크롭 후 프레임 안에서 어디인지 (원본 256 기준 중앙)
        "anchorX": (FRAME_H / 2) - x0,
        "anims": anims,
    }


def bake_icon(path, out_dir):
    """아이콘은 여백을 잘라내고 높이 기준으로 줄여서 저장한다."""
    icon = Image.open(path).convert("RGBA")
    box = icon.getchannel("A").getbbox()
    icon = icon.crop(box)

    scale = ICON_HEIGHT / icon.height
    icon = icon.resize((max(1, round(icon.width * scale)), ICON_HEIGHT), Image.LANCZOS)

    out = out_dir / path.name
    icon.save(out, optimize=True)
    print("  %s  %dx%d" % (out.name, icon.width, icon.height))
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
    strip.save(out, optimize=True)
    print("  %s  %dx%d  (%d glyphs)" % (out.name, strip.width, strip.height, len(metrics)))

    return {"file": out.name, "refHeight": FONT_HEIGHT, "glyphs": metrics}


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python tools/build_sprites.py <원본_에셋_폴더>")

    src = Path(sys.argv[1])
    out_dir = Path(__file__).resolve().parent.parent / "assets"
    out_dir.mkdir(exist_ok=True)

    manifest = {"player": None, "enemies": {}, "background": "game_bg.png"}

    print("player:")
    player_anims = {a: load_frames(src / ("player_" + a + ".gif")) for a in PLAYER_ANIMS}
    manifest["player"] = bake("player", player_anims, out_dir)

    print("enemies:")
    for i in range(1, ENEMY_COUNT + 1):
        gif = src / "enemy" / ("enemy_%d.gif" % i)
        if not gif.exists():
            print("  skip enemy_%d (없음)" % i)
            continue
        manifest["enemies"][str(i)] = bake("enemy_%d" % i, {"move": load_frames(gif)}, out_dir)

    bg = Image.open(src / "game_bg.png").convert("RGB")
    bg.save(out_dir / "game_bg.png", optimize=True)
    manifest["backgroundSize"] = [bg.width, bg.height]
    print("background: game_bg.png  %dx%d" % (bg.width, bg.height))

    sprites = src / "sprites"
    if sprites.is_dir():
        print("icons:")
        manifest["icons"] = {name: bake_icon(sprites / (name + ".png"), out_dir) for name in ICONS}
        print("font:")
        manifest["font"] = bake_font(sprites / "font.png", out_dir)

    body = json.dumps(manifest, indent=2)
    (out_dir / "sprites.json").write_text(body, encoding="utf-8")

    # file:// 로 열었을 때 fetch 는 CORS 로 막히므로 JS 전역으로도 굽는다
    js = "// build_sprites.py 가 생성한 파일. 직접 수정하지 말 것.\nwindow.SPRITE_MANIFEST = " + body + ";\n"
    (out_dir / "sprites.js").write_text(js, encoding="utf-8")

    print("\n-> " + str(out_dir / "sprites.json"))
    print("-> " + str(out_dir / "sprites.js"))


if __name__ == "__main__":
    main()
