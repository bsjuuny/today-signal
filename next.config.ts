import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',      // 정적 파일 출력 (out/ 디렉터리)
  basePath: '/todaysignal',
  trailingSlash: true,   // Cafe24 정적 호스팅 호환
  images: {
    unoptimized: true,   // 정적 export 시 필수
  },
};

export default nextConfig;
