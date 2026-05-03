// Nango OAuth callback — for future OAuth2 providers routed through Nango.
// MaintainX uses API-key auth, so this route handles providers like Limble (OAuth2)
// once those are configured in providers.yaml.
//
// Flow: Provider → Nango → Nango callback (/oauth/callback on Nango server) →
//       Nango stores token → redirects here with ?provider=X&connection_id=Y&success=true

import { type NextRequest, NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/nango";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider");
  const connectionId = searchParams.get("connection_id");
  const success = searchParams.get("success");
  const errorDescription = searchParams.get("error_description");

  const redirectBase = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/hub/channels`;

  if (!provider || !connectionId) {
    return NextResponse.redirect(
      `${redirectBase}?provider=unknown&status=error&reason=missing+params`
    );
  }

  if (success !== "true") {
    return NextResponse.redirect(
      `${redirectBase}?provider=${provider}&status=error&reason=${encodeURIComponent(
        errorDescription ?? "OAuth failed"
      )}`
    );
  }

  // Verify the connection is healthy in Nango before telling the Hub it succeeded.
  const status = await getConnectionStatus(provider, connectionId);
  if (!status.connected) {
    return NextResponse.redirect(
      `${redirectBase}?provider=${provider}&status=error&reason=connection+not+found+in+nango`
    );
  }

  const meta = encodeURIComponent(
    JSON.stringify({ nangoConnectionId: connectionId, provider })
  );

  return NextResponse.redirect(
    `${redirectBase}?provider=${provider}&status=connected&meta=${meta}`
  );
}
