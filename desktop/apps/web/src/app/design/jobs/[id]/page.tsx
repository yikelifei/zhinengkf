import { WorkbenchDetailRoutePage } from "../../../route-page";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <WorkbenchDetailRoutePage routeId="designJobDetail" entityId={id} />;
}
