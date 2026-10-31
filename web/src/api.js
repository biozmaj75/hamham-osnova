// The site and the API share one address: CloudFront forwards /api to the cloud function, the local server (local/server.mjs) serves both
const API_BASE = '/api';

const TOKEN_KEY = 'dorm-meals-token';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
};

export async function api(action, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(API_BASE, { method: 'POST', headers, body: JSON.stringify({ action, ...params }) });
  let data;
  try { data = await res.json(); } catch { throw new Error('Strežnik se ni odzval. Poskusite znova.'); }
  if (res.status === 401 && action !== 'login') {
    session.token = null;
    window.dispatchEvent(new Event('signed-out'));
  }
  if (!res.ok) throw new Error(data.error || 'Zahteva ni uspela');
  return data;
}
