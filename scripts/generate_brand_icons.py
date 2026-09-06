from pathlib import Path

from PIL import (
    Image,
    ImageDraw,
    ImageFilter,
)

ROOT = Path(__file__).resolve().parents[1]

PUBLIC = ROOT / "frontend" / "public"


LEFT_HALF = [
    (5, 8),
    (23, 8),
    (23, 34),
    (43, 34),
    (30, 51),
    (23, 51),
    (23, 80),
    (5, 80),
]


RIGHT_HALF = [
    (71, 8),
    (53, 8),
    (53, 33),
    (33, 33),
    (46, 50),
    (53, 50),
    (53, 80),
    (71, 80),
]


BOLT = [
    (51, 1),
    (17, 47),
    (34, 47),
    (20, 87),
    (62, 35),
    (45, 35),
]


BOLT_HIGHLIGHT = [
    (49, 5),
    (22, 43),
    (39, 43),
    (26, 78),
    (57, 39),
    (40, 39),
]


def transform_points(
    points: list[tuple[int, int]],
    size: int,
) -> list[tuple[int, int]]:
    scale = size * 0.64 / 88

    x_offset = size / 2 - 38 * scale

    y_offset = size / 2 - 44 * scale

    return [
        (
            round(x_offset + x * scale),
            round(y_offset + y * scale),
        )
        for x, y in points
    ]


def generate_icon(
    size: int,
    filename: str,
) -> None:
    image = Image.new(
        "RGBA",
        (size, size),
        (
            3,
            7,
            11,
            255,
        ),
    )

    ambient = Image.new(
        "RGBA",
        (size, size),
        (
            0,
            0,
            0,
            0,
        ),
    )

    ambient_draw = ImageDraw.Draw(
        ambient,
    )

    glow_margin = round(
        size * 0.15,
    )

    ambient_draw.ellipse(
        (
            glow_margin,
            glow_margin,
            size - glow_margin,
            size - glow_margin,
        ),
        fill=(
            0,
            108,
            255,
            70,
        ),
    )

    ambient = ambient.filter(
        ImageFilter.GaussianBlur(
            radius=size * 0.10,
        )
    )

    image = Image.alpha_composite(
        image,
        ambient,
    )

    left = transform_points(
        LEFT_HALF,
        size,
    )

    right = transform_points(
        RIGHT_HALF,
        size,
    )

    bolt = transform_points(
        BOLT,
        size,
    )

    highlight = transform_points(
        BOLT_HIGHLIGHT,
        size,
    )

    glow = Image.new(
        "RGBA",
        (size, size),
        (
            0,
            0,
            0,
            0,
        ),
    )

    glow_draw = ImageDraw.Draw(
        glow,
    )

    glow_draw.polygon(
        bolt,
        fill=(
            0,
            174,
            255,
            220,
        ),
    )

    glow = glow.filter(
        ImageFilter.GaussianBlur(
            radius=max(
                2,
                size * 0.025,
            ),
        )
    )

    image = Image.alpha_composite(
        image,
        glow,
    )

    draw = ImageDraw.Draw(
        image,
    )

    draw.polygon(
        left,
        fill=(
            153,
            165,
            174,
            255,
        ),
    )

    draw.polygon(
        right,
        fill=(
            211,
            221,
            226,
            255,
        ),
    )

    outline_width = max(
        1,
        round(
            size * 0.004,
        ),
    )

    draw.line(
        left + [left[0]],
        fill=(
            245,
            248,
            250,
            130,
        ),
        width=outline_width,
        joint="curve",
    )

    draw.line(
        right + [right[0]],
        fill=(
            245,
            248,
            250,
            115,
        ),
        width=outline_width,
        joint="curve",
    )

    draw.polygon(
        bolt,
        fill=(
            0,
            143,
            239,
            255,
        ),
    )

    highlight_width = max(
        1,
        round(
            size * 0.005,
        ),
    )

    draw.line(
        highlight + [highlight[0]],
        fill=(
            200,
            251,
            255,
            180,
        ),
        width=highlight_width,
        joint="curve",
    )

    destination = PUBLIC / filename

    image.convert(
        "RGB",
    ).save(
        destination,
        format="PNG",
        optimize=True,
    )

    print(f"Created {destination}")


def main() -> None:
    PUBLIC.mkdir(
        parents=True,
        exist_ok=True,
    )

    generate_icon(
        180,
        "apple-touch-icon.png",
    )

    generate_icon(
        192,
        "icon-192.png",
    )

    generate_icon(
        512,
        "icon-512.png",
    )


if __name__ == "__main__":
    main()
