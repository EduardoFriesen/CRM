import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  return (
    <>
      <SettingsNav slug={(await params).slug} />
      {children}
    </>
  );
}
