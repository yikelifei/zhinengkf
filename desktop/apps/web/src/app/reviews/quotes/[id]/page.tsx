import { ReviewQuotesPage } from "../../../../features/reviews/review-quotes-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="reviewQuoteDecision">
      <ReviewQuotesPage key={id} reviewId={id} />
    </FeatureRouteShell>
  );
}
