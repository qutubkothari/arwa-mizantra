import MisWorkspace from "@/components/reports/MisWorkspace";

export default async function MisReportPage({ params }: { params: Promise<{ domain: string; view: string }> }) {
  const { domain, view } = await params;
  return <MisWorkspace domain={domain} view={view} />;
}
