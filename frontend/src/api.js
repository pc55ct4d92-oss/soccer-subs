const BASE = import.meta.env.VITE_API_URL || '';

export function api(path, options) {
  return fetch(`${BASE}${path}`, options);
}
