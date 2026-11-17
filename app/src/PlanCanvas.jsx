import React, { useEffect, useRef, useState } from 'react';
import { dragPlanRoom, MIN_ROOM_SPAN, planRoomDimensions } from './planTools';

const handles = [
  ['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5],
  ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5],
];
const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const extent = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
});

export default function PlanCanvas({
  rooms, active, ratio, backdropUrl, zone, circulation, editable, planSize, snap, onSelect, onEdit, onAdd,
}) {
  const [preview, setPreview] = useState(null);
  const [unitsPerPixel, setUnitsPerPixel] = useState(1);
  const svgRef = useRef(null);
  const gesture = useRef(null);
  const viewHeight = 1000 / ratio;

  useEffect(() => {
    const svg = svgRef.current;
    const resize = new ResizeObserver(() => {
      const matrix = svg.getScreenCTM();
      const scale = matrix && Math.hypot(matrix.a, matrix.b);
      if (scale > 0) setUnitsPerPixel(1 / scale);
    });
    resize.observe(svg);
    return () => resize.disconnect();
  }, [ratio]);

  function point(event, matrix) {
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    const limit = value => Math.max(0, Math.min(1, value));
    return { x: limit(p.x / 1000), y: limit(p.y / viewHeight) };
  }

  function start(event) {
    if (!editable || event.button !== 0 || gesture.current) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse();
    const index = Number(event.target.dataset.room ?? -1);
    const room = rooms[index];
    const handle = event.target.dataset.handle || 'move';
    gesture.current = {
      pointerId: event.pointerId, start: point(event, inverse), inverse, index, room, handle,
      client: [event.clientX, event.clientY],
      tolerance: [7 / (1000 * Math.hypot(matrix.a, matrix.b)), 7 / (viewHeight * Math.hypot(matrix.c, matrix.d))],
    };
    if (room) onSelect(index);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event, current) {
    if (Math.hypot(event.clientX - current.client[0], event.clientY - current.client[1]) < 3) return null;
    const next = point(event, current.inverse);
    if (!current.room) return extent(current.start, next);
    const delta = { x: next.x - current.start.x, y: next.y - current.start.y };
    const neighbors = snap && !event.altKey ? rooms.filter((_, index) => index !== current.index) : [];
    return dragPlanRoom(current.room, current.handle, delta, planSize, neighbors,
      snap && !event.altKey ? current.tolerance : [0, 0]);
  }

  function move(event) {
    const current = gesture.current;
    if (current?.pointerId === event.pointerId) setPreview(drag(event, current));
  }

  function finish(event, apply) {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(null);
    if (!apply || !editable) return;
    const room = drag(event, current);
    if (!room) return;
    if (current.room) onEdit(current.index, room);
    else if (room.w >= MIN_ROOM_SPAN && room.h >= MIN_ROOM_SPAN) onAdd(room);
  }

  function keyRoom(event, room, index) {
    if (!editable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(index);
      return;
    }
    const direction = arrows[event.key];
    if (!direction) return;
    event.preventDefault();
    const [width, depth] = planRoomDimensions(room, planSize);
    const metres = event.shiftKey ? .1 : .01;
    onSelect(index);
    onEdit(index, dragPlanRoom(room, 'move', {
      x: direction[0] * metres * room.w / width, y: direction[1] * metres * room.h / depth,
    }, planSize));
  }

  const currentIndex = gesture.current?.index;
  const displayed = preview && currentIndex >= 0
    ? rooms.map((room, index) => index === currentIndex ? preview : room)
    : rooms;
  const selected = displayed[active];

  return <svg ref={svgRef} className="plan" viewBox={`0 0 1000 ${viewHeight}`} aria-label="户型平面"
    onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event, true)}
    onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}>
    {backdropUrl && <image href={backdropUrl} width="1000" height={viewHeight} />}
    {displayed.map((room, index) => {
      const chosen = index === active;
      const cx = (room.x + room.w / 2) * 1000;
      const cy = (room.y + room.h / 2) * viewHeight;
      return <g key={index}>
        <rect data-room={index} className={editable ? 'editable-room' : undefined}
          x={room.x * 1000} y={room.y * viewHeight} width={room.w * 1000} height={room.h * viewHeight}
          fill={chosen ? '#7fc9a0' : '#bfe0c8'} fillOpacity={chosen ? .28 : .18}
          stroke={chosen ? '#257048' : '#8dbfa2'} strokeWidth={chosen ? 2 : 1} vectorEffect="non-scaling-stroke"
          role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined}
          aria-label={editable ? `选择房间：${room.name}` : undefined} aria-pressed={editable ? chosen : undefined}
          onKeyDown={event => keyRoom(event, room, index)} />
        {zone && chosen ? <>
          <line x1={(room.x + (zone.axis === 'x' ? room.w * zone.split : 0)) * 1000}
            x2={(room.x + (zone.axis === 'x' ? room.w * zone.split : room.w)) * 1000}
            y1={(room.y + (zone.axis === 'y' ? room.h * zone.split : 0)) * viewHeight}
            y2={(room.y + (zone.axis === 'y' ? room.h * zone.split : room.h)) * viewHeight}
            stroke="#439a70" strokeWidth="3" strokeDasharray="10 8" pointerEvents="none" />
          {zone.labels.map((label, labelIndex) => <text key={labelIndex} className="room-area"
            x={(room.x + room.w * (zone.axis === 'x' ? (labelIndex + zone.split) / 2 : .5)) * 1000}
            y={(room.y + room.h * (zone.axis === 'y' ? (labelIndex + zone.split) / 2 : .5)) * viewHeight}
            textAnchor="middle" pointerEvents="none">{label}</text>)}
        </> : <>
          <text x={cx} y={cy} textAnchor="middle" pointerEvents="none">{room.name}</text>
          {(chosen && editable || room.area) && <text className="room-area" x={cx} y={cy + (chosen && editable ? 16 * unitsPerPixel : 26)}
            style={chosen && editable ? { fontSize: 12 * unitsPerPixel, strokeWidth: 2 * unitsPerPixel } : undefined}
            textAnchor="middle" pointerEvents="none">
            {chosen && editable ? planRoomDimensions(room, planSize).map(value => value.toFixed(2)).join(' × ') + ' m' : `${room.area} ㎡`}
          </text>}
        </>}
      </g>;
    })}
    {preview && currentIndex === -1 && <rect x={preview.x * 1000} y={preview.y * viewHeight}
      width={preview.w * 1000} height={preview.h * viewHeight} fill="#bfe0c8" fillOpacity=".28"
      stroke="#439a70" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="5 4" pointerEvents="none" />}
    {circulation?.length > 1 && <polyline points={circulation.map(p => `${p.x * 1000},${p.y * viewHeight}`).join(' ')}
      fill="none" stroke="#b96b39" strokeWidth="5" strokeDasharray="12 7" pointerEvents="none" />}
    {editable && selected && handles.map(([handle, x, y]) => {
      const cx = (selected.x + selected.w * x) * 1000;
      const cy = (selected.y + selected.h * y) * viewHeight;
      return <g key={handle} aria-hidden="true">
        <circle className="plan-room-handle" cx={cx} cy={cy} r={4 * unitsPerPixel} vectorEffect="non-scaling-stroke" />
        <circle className="plan-room-handle-hit" data-handle={handle} data-room={active}
          cx={cx} cy={cy} r={4 * unitsPerPixel} vectorEffect="non-scaling-stroke" />
      </g>;
    })}
  </svg>;
}
