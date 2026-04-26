import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'haera',
  description: '여러 경로로 들어온 업무를 정리하는 개인용 도구',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
