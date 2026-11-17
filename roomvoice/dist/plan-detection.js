// Fill short breaks along wall lines, such as door openings in a line drawing.
function bridge(walls, lineCount, lineLength, lineStride, pixelStride, gap) {
  for (let line = 0; line < lineCount; line++) {
    const start = line * lineStride;
    let last = -gap - 2;
    for (let i = 0; i < lineLength; i++) {
      if (!walls[start + i * pixelStride]) continue;
      if (i - last <= gap + 1) {
        for (let j = last + 1; j < i; j++) walls[start + j * pixelStride] = 1;
      }
      last = i;
    }
  }
}

export function findRooms(pixels, width, height, threshold, gap) {
  const walls = new Uint8Array(width * height);
  for (let i = 0; i < walls.length; i++) {
    const p = i * 4;
    const luminance = pixels[p] * .2126 + pixels[p + 1] * .7152 + pixels[p + 2] * .0722;
    walls[i] = luminance < threshold;
  }
  bridge(walls, height, width, width, 1, gap);
  bridge(walls, width, height, 1, width, gap);
  const queue = new Int32Array(walls.length);
  const candidates = [];
  for (let start = 0; start < walls.length; start++) {
    if (walls[start]) continue;
    let head = 0, tail = 0, left = width, right = -1, top = height, bottom = -1;
    const visit = index => {
      if (walls[index]) return;
      walls[index] = 1;
      queue[tail++] = index;
    };
    visit(start);
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y < height - 1) visit(index + width);
    }
    if (left === 0 || top === 0 || right === width - 1 || bottom === height - 1) continue;
    const w = right - left + 1, h = bottom - top + 1;
    if (w < width * .055 || h < height * .055 || tail < walls.length * .007 || tail < w * h * .71) continue;
    candidates.push({x:left / width, y:top / height, w:w / width, h:h / height, area:tail});
  }
  return candidates
    .sort((a,b) => b.area - a.area)
    .filter((room, i, list) => !list.slice(0, i).some(other => {
      const w = Math.min(room.x + room.w, other.x + other.w) - Math.max(room.x, other.x);
      const h = Math.min(room.y + room.h, other.y + other.h) - Math.max(room.y, other.y);
      return w > 0 && h > 0 && w * h > room.w * room.h * .35;
    }))
    .slice(0, 20);
}

export function readPlanPixels(image) {
  const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', {alpha:false, willReadFrequently:true});
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
