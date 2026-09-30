// PROTOTYPE, throwaway. Answers issue #15 "Layout and visual language prototype".
// Three layout variants of the editor, switchable via ?variant=A|B|C.
import Prototype from "./prototype";

export default async function Page({
  searchParams,
}: PageProps<"/prototype/layout">) {
  const v = (await searchParams).variant;
  const variant = typeof v === "string" && ["A", "B", "C"].includes(v) ? v : "A";
  return <Prototype variant={variant as "A" | "B" | "C"} />;
}
