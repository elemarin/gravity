import type { Metadata, Viewport } from 'next';
import { Press_Start_2P } from 'next/font/google';
import './globals.css';

const pressStart = Press_Start_2P({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-pixel',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Gravity — Space Program Arcade',
  description: 'Low-poly orbital arcade game. Build rockets, complete milestones, conquer space.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#06000d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pressStart.variable}>
      <body className="bg-bg text-ink font-pixel">{children}</body>
    </html>
  );
}
