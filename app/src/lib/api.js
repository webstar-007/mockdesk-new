export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
function deviceId() { try { let d = localStorage.getItem('md_device'); if (!d) { d = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/[^\w-]/g, ''); localStorage.setItem('md_device', d); } return d; } catch { return ''; } }
async function req(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, { method, credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(deviceId() ? { 'X-Device-Id': deviceId() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError('Network problem. Check your connection.', 0, 'NETWORK'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 503 && data?.code === 'MAINTENANCE') window.dispatchEvent(new CustomEvent('md-maint', { detail: data.error }));
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  return data;
}
async function upload(file) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new ApiError('Choose a PNG, JPG, WebP or GIF image', 0);
  if (file.size > 4 * 1024 * 1024) throw new ApiError('Image is larger than 4 MB', 0);
  const res = await fetch('/api/admin/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Upload failed', res.status);
  return data.url;
}
export const api = {
  del: (u, b) => req('DELETE', u, b), upload,
  get: (u) => req('GET', u), post: (u, b) => req('POST', u, b ?? {}), put: (u, b) => req('PUT', u, b), patch: (u, b) => req('PATCH', u, b),
};
