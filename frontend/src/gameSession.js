const KEY = 'gaffer-active-session';

export function saveSession(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (_) {}
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
