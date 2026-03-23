import type { Metadata } from "next";
import { getCurrentUser } from "./_lib/user";
import Nav from "./_components/Nav";
import ChatWidget from "./_components/ChatWidget";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compass",
  description: "Personal travel intelligence",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    viewportFit: "cover",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        <Nav
          userName={user?.name}
          isOwner={user?.isOwner}
        />
        {children}
        {user && <ChatWidget />}
      </body>
    </html>
  );
}
