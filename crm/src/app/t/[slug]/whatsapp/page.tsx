import { WhatsAppPanel } from "./whatsapp-panel";

export default async function WhatsAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="page">
      <h1>Conectar WhatsApp</h1>
      <p className="warning" role="note">
        Usá un número dedicado: la conexión es por WhatsApp Web no oficial y puede ser bloqueada.
      </p>
      <WhatsAppPanel slug={slug} />
    </main>
  );
}
