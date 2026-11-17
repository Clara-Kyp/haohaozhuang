import React, { useState } from 'react';
import { MAX_PLAN_ROOMS } from './planTools';

export function RecognitionDimensions({ rows, onChange }) {
  function update(id, patch) {
    onChange(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  return <details className="recognition-dimensions">
    <summary>房间尺寸条件（选填）{rows.length > 0 && ` · ${rows.length} 间`}</summary>
    <p className="card-sub">填入已知尺寸，下次识别时参考。宽度沿图纸左右，进深沿上下。</p>
    {rows.map((row, index) => <div className="recognition-room" key={row.id} role="group" aria-label={`房间 ${index + 1} 的识别条件`}>
      <label>房间名称<input type="text" maxLength={24} placeholder="例如：主卧" value={row.name}
        onChange={event => update(row.id, { name: event.target.value })} /></label>
      <div className="calibration-fields">
        <label>宽度（米）<input type="number" min="1" max="60" step="0.01" value={row.width}
          onChange={event => update(row.id, { width: event.target.value })} /></label>
        <label>进深（米）<input type="number" min="1" max="60" step="0.01" value={row.depth}
          onChange={event => update(row.id, { depth: event.target.value })} /></label>
      </div>
      <button className="pill" type="button" aria-label={`移除第 ${index + 1} 间房的尺寸条件`}
        onClick={() => onChange(rows.filter(item => item.id !== row.id))}>移除</button>
    </div>)}
    <button className="pill" type="button" disabled={rows.length >= MAX_PLAN_ROOMS}
      onClick={() => onChange([...rows, { id: crypto.randomUUID(), name: '', width: '', depth: '' }])}>
      添加房间尺寸
    </button>
  </details>;
}

export function RoomDimensionsForm({ size, onApply }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const key = size.join(',');
  const values = draft?.key === key ? draft.values : size.map(value => value.toFixed(2));

  function update(index, value) {
    setError(null);
    setDraft({ key, values: values.map((current, axis) => axis === index ? value : current) });
  }

  function apply(event) {
    event.preventDefault();
    try {
      onApply(values.map(Number));
      setDraft(null);
      setError(null);
    } catch (failure) {
      setError({ key, message: failure.message });
    }
  }

  return <form className="room-dimensions-form" onSubmit={apply}>
    <label>房间宽度（米）<input type="number" min="1" max="60" step="0.01" required value={values[0]}
      onChange={event => update(0, event.target.value)} /></label>
    <label>房间进深（米）<input type="number" min="1" max="60" step="0.01" required value={values[1]}
      onChange={event => update(1, event.target.value)} /></label>
    <button className="pill" type="submit">应用尺寸</button>
    {error?.key === key && <p className="plan-error" role="alert">{error.message}</p>}
  </form>;
}
