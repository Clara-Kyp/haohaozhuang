import React, { useState } from 'react';
import { cloudApiOrigin, cloudRequest } from './deployment';

export default function OnlineAccess({ onEnable }) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  if (!cloudApiOrigin) return null;

  async function enable(event) {
    event.preventDefault();
    const value = code.trim();
    setChecking(true);
    setError('');
    try {
      await cloudRequest('access', value);
      onEnable(value);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setChecking(false);
    }
  }

  return <details className="online-access">
    <summary>有邀请码？启用在线 AI</summary>
    <form className="stack" onSubmit={enable} aria-busy={checking}>
      <label>在线 AI 邀请码
        <input value={code} type="password" required autoComplete="off"
          onChange={event => setCode(event.target.value)} />
      </label>
      <button type="submit" disabled={checking}>{checking ? '正在连接…' : '连接在线 AI'}</button>
      {error && <p className="notice warn" role="alert">{error}</p>}
    </form>
  </details>;
}
