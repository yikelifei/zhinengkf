import { TrainingReviewDetailPage } from "../../../../features/training/training-review-detail-page";
import { FeatureRouteShell } from "../../../feature-route-shell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return (
    <FeatureRouteShell routeId="trainingReviewDetail">
      <TrainingReviewDetailPage key={id} sampleId={id} />
    </FeatureRouteShell>
  );
}
