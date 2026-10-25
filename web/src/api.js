const API_BASE = 'https://2ra4to2hk6ywoqgcfs2qlcy7fe0uybsk.lambda-url.eu-central-1.on.aws';

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
  try { data = await res.json(); } catch { throw new Error('The server did not answer. Please try again.'); }
  if (res.status === 401 && action !== 'login') {
    session.token = null;
    window.dispatchEvent(new Event('signed-out'));
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
