import { getAgentView } from "@/agent/config";
import { availableProviders, MODEL_SUGGESTIONS, ROUTER_SUGGESTIONS } from "@/agent/model";
import { getCurrentTenant } from "@/tenants/tenants";
import { AgentForm } from "./agent-form";
import { TestChat } from "./test-chat";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const view = await getAgentView(tenant.id);
  return (
    <main className="page">
      <div className="page-head">
        <h1>Agente</h1>
        <p className="meta">Cómo responde el bot de {tenant.name} por WhatsApp.</p>
      </div>
      <div className="agent-layout">
        <AgentForm slug={tenant.slug} view={view} suggestions={MODEL_SUGGESTIONS} routerSuggestions={ROUTER_SUGGESTIONS} providers={availableProviders()} adminPhone={tenant.adminPhone} />
        <TestChat slug={tenant.slug} configured={view !== null} />
      </div>
    </main>
  );
}
