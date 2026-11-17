import styleCatalog from './styleCatalog.json' with { type: 'json' };

export const styleNames = styleCatalog.map(profile => profile.name);
const profiles = new Map(styleCatalog.flatMap(profile =>
  [profile.name, ...profile.aliases].map(name => [name.toLowerCase(), profile]),
));
const keywords = [...profiles.keys()].sort((a, b) => b.length - a.length);

export function getStyleProfile(name) {
  return profiles.get(String(name ?? '').trim().toLowerCase());
}

export function canonicalStyle(name) {
  return getStyleProfile(name)?.name ?? String(name ?? '').trim();
}

export function styleFromText(text) {
  const lower = text.toLowerCase();
  const keyword = keywords.find(name => lower.includes(name));
  return profiles.get(keyword)?.name;
}
