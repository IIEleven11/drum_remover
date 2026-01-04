/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // Optimizes the build for Docker
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;