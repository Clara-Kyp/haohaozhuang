export const isShowcase = import.meta.env.MODE === 'showcase';
export function publicAsset(path) {
  return path.startsWith('/') ? import.meta.env.BASE_URL + path.slice(1) : path;
}
