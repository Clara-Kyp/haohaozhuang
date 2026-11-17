"""Confirm approximate room edges against solid wall bands in the uploaded plan."""
from io import BytesIO

from PIL import Image, UnidentifiedImageError


def _wall_edge(dark, glazing, position, start, end, inner_direction):
    axis_size, span_size = dark.size
    span = end - start
    if span < 20:
        return position

    radius = min(round(axis_size * .10), round(span * .40))
    max_thickness = max(2, round(axis_size * .04))
    first = max(0, position - radius - max_thickness)
    last = min(axis_size, position + radius + max_thickness + 1)
    strip = dark.crop((first, start, last, end)).tobytes()
    windows = glazing.crop((first, start, last, end)).tobytes()
    stride = last - first
    minimum_thickness = max(2, round(min(axis_size, span_size) * .004))
    bands = []
    for offset in range(stride):
        solid = strip[offset::stride]
        glass = windows[offset::stride]
        black_count = solid.count(1)
        glass_count = glass.count(1)
        # A window symbol may interrupt an otherwise aligned wall band.
        has_window = black_count >= max(4, round(span * .08)) and glass_count >= span * .35
        if black_count >= span * .38 or (has_window and black_count + glass_count >= span * .63):
            axis = first + offset
            if not bands or bands[-1][-1] != axis - 1:
                bands.append([])
            bands[-1].append(axis)

    eligible = [
        band[-1] + 1 if inner_direction > 0 else band[0]
        for band in bands
        if minimum_thickness <= len(band) <= max_thickness
        and band[0] > first and band[-1] + 1 < last
    ]
    nearby = (edge for edge in eligible if abs(edge - position) <= radius)
    return min(nearby, key=lambda edge: abs(edge - position), default=position)


def _overlap(a, b):
    l, t, r, d = a
    return max(0, min(r, b[2]) - max(l, b[0])) * max(0, min(d, b[3]) - max(t, b[1]))


def align_room_edges(data, rooms):
    if not rooms:
        return 0
    try:
        with Image.open(BytesIO(data)) as source:
            source.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            image = source.convert("RGB")
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        return 0

    w, h = image.size
    pixels = image.get_flattened_data()
    dark = Image.frombytes("L", (w, h), bytes(max(rgb) <= 40 for rgb in pixels))
    glazing = Image.frombytes("L", (w, h), bytes(
        b >= 120 and b - r >= 22 and g - r >= 12 for r, g, b in pixels
    ))
    horizontal = dark.transpose(Image.Transpose.TRANSPOSE)
    horizontal_glazing = glazing.transpose(Image.Transpose.TRANSPOSE)
    original = [
        (round(room["x"] * w), round(room["y"] * h),
         round((room["x"] + room["w"]) * w), round((room["y"] + room["h"]) * h))
        for room in rooms
    ]
    current = list(original)
    for shrinking in (True, False):
        # Align inward edges first so a neighboring box can expand into the cleared area.
        for i, (left, top, right, bottom) in enumerate(current):
            edges = [
                _wall_edge(dark, glazing, left, top, bottom, 1),
                _wall_edge(horizontal, horizontal_glazing, top, left, right, 1),
                _wall_edge(dark, glazing, right, top, bottom, -1),
                _wall_edge(horizontal, horizontal_glazing, bottom, left, right, -1),
            ]
            for edge, value in enumerate(edges):
                candidate = list(current[i])
                delta = value - candidate[edge]
                inward = delta > 0 if edge < 2 else delta < 0
                if abs(delta) < 2 or inward != shrinking:
                    continue
                candidate[edge] = value
                if candidate[2] - candidate[0] < .025 * w or candidate[3] - candidate[1] < .025 * h:
                    continue
                if any(_overlap(candidate, other) > _overlap(current[i], other)
                       for j, other in enumerate(current) if j != i):
                    continue
                current[i] = tuple(candidate)

    adjusted = 0
    for i, (left, top, right, bottom) in enumerate(current):
        if current[i] != original[i]:
            rooms[i].update(x=round(left / w, 5), y=round(top / h, 5),
                            w=round((right - left) / w, 5), h=round((bottom - top) / h, 5))
            adjusted += 1
    return adjusted
