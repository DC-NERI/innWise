import type { Metadata } from 'next';
import { Inter as Geist } from 'next/font/google'; // Using Inter as a Geist placeholder if Geist is not directly available like this. The original setup used Geist and Geist_Mono.
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Added Toaster

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

// const geistMono = Geist_Mono({ // Assuming Geist_Mono might not be used extensively in this request, can be added if needed
//   variable: '--font-geist-mono',
//   subsets: ['latin'],
// });

export const metadata: Metadata = {
  title: 'InnWise - Hotel Management Login',
  description: 'Secure login for InnWise application',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased font-sans`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
