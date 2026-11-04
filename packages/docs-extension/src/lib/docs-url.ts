export function documentIdFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  const match = url.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  return match === null ? null : (match[1] as string);
}
