export function getAppUrl(): string {
  const configuredUrl = import.meta.env.VITE_APP_URL?.trim();
  return (configuredUrl || window.location.origin).replace(/\/+$/, '');
}
