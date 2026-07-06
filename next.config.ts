import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.24benz.ru" }],
        destination: "https://24benz.ru/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
