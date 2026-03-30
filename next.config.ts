import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  images: {
    formats: ['image/webp', 'image/avif'],
  },
};

export default nextConfig;
