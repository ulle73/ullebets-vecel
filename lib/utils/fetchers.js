export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchJsonAllow404(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchTeamProfile(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    return { profile: null };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
