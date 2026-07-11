/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "unpdf"],
  experimental: {
    // Allow PDF/markdown uploads through server actions (Netlify's function
    // request ceiling is ~6MB; larger docs should be uploaded as markdown).
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
