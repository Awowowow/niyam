import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Niyam — When policy and software disagree",
  description:
    "Catch silent wrong decisions by proving whether live software follows an approved written policy.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var s=localStorage.getItem("niyam-theme-preference");var t=s==="dark"?"dark":"light";document.documentElement.dataset.niyamTheme=t;document.documentElement.style.colorScheme=t}catch(e){}})()',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
