import { ReviewOrdersPage } from "../../../../features/reviews/review-orders-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="reviewOrderDecision">
      <ReviewOrdersPage key={id} reviewId={id} />
    </FeatureRouteShell>
  );
}
