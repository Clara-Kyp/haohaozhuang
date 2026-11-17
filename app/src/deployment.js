export const isShowcase = import.meta.env.MODE === 'showcase';
export function publicAsset(path) {
  return path.startsWith('/') ? import.meta.env.BASE_URL + path.slice(1) : path;
}

export const cloudApiOrigin = (import.meta.env.VITE_AI_API_ORIGIN || '').replace(/\/$/, '');

export async function cloudRequest(path, code, body) {
  let response;
  try {
    response = await fetch(cloudApiOrigin + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Access-Code': code,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('无法连接线上 AI，请稍后重试。');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '线上 AI 请求失败，请稍后重试。');
  return data;
}
