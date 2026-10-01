import { notFound } from "next/navigation";
import { TemplateScreen } from "../../template-screen";

export default async function VersionPage({
  params,
  searchParams,
}: PageProps<"/t/[templateId]/v/[number]">) {
  const { templateId, number } = await params;
  const version = parseVersionParam(number);
  if (version === null) notFound();
  return <TemplateScreen templateId={templateId} searchParams={searchParams} requestedVersion={version} />;
}

/** A positive integer with no leading zero. Anything else is not a Version number. */
function parseVersionParam(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  return number;
}
