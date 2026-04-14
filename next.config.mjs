/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // serverActions are enabled by default in Next.js 15
  },
  images: {
    // Inline SVGs from checker-pattern etc; remote images not needed in MVP
    remotePatterns: [],
  },
  // Supabase Storage signed URLs are fetched server-side; no rewrites needed.
};

export default nextConfig;
