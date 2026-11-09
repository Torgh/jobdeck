import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf/docx parsers stay as plain Node modules instead of being bundled.
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
