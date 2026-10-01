import { TemplateScreen } from "./template-screen";

export default async function TemplatePage({ params, searchParams }: PageProps<"/t/[templateId]">) {
  const { templateId } = await params;
  return <TemplateScreen templateId={templateId} searchParams={searchParams} requestedVersion={null} />;
}
