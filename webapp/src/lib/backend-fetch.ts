// Bind an API operation to the backend the form was rendered for.
export function backendFetch(input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const target = document.documentElement.dataset.backend;
  if (target) headers.set("x-reactor-backend", target);
  return fetch(input, { ...init, headers });
}
