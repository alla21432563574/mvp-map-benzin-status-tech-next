type PublicCacheOptions = {
  browserMaxAge: number;
  edgeMaxAge: number;
  staleWhileRevalidate?: number;
};

export function publicCacheHeaders({ browserMaxAge, edgeMaxAge, staleWhileRevalidate }: PublicCacheOptions) {
  const edgeDirectives = [
    "public",
    `max-age=${edgeMaxAge}`,
    staleWhileRevalidate ? `stale-while-revalidate=${staleWhileRevalidate}` : null,
  ].filter(Boolean).join(", ");

  return {
    "Cache-Control": `public, max-age=${browserMaxAge}`,
    "CDN-Cache-Control": edgeDirectives,
    "Vercel-CDN-Cache-Control": edgeDirectives,
  };
}
