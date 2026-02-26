import "@/style/globals.css";
import { Toaster } from 'sonner'

export const metadata = {
  title: "Pasya on Chain",
  description: "Modern attendance monitoring and verification system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
