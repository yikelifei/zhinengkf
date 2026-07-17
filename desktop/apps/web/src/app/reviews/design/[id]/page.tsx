import { ReviewDesignPage } from "../../../../features/reviews/review-design-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="reviewDesignDecision">
      <ReviewDesignPage key={id} reviewId={id} />
    </FeatureRouteShell>
  );
}
